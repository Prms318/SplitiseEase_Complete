import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
from fastapi import Depends, FastAPI, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from services.auth.app.models import AdminAuditEvent, AdminInvitation, ProGrant, RefreshSession, User
from services.common.app import configure_app
from services.common.config import env
from services.common.database import create_session_factory, get_session
from services.common.security import create_access_token, require_internal_token, require_user_id


engine, SessionLocal = create_session_factory()
app = FastAPI(title="SplitEase Auth Service", version="1.0.0", docs_url="/auth/docs", openapi_url="/auth/openapi.json", redoc_url=None)
configure_app(app)


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=72)


class RegisterRequest(Credentials):
    display_name: str = Field(min_length=1, max_length=120)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=32, max_length=200)


class UserLookup(BaseModel):
    user_ids: list[UUID] = Field(min_length=1, max_length=100)


class InvitationCreate(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)


class InvitationAccept(BaseModel):
    token: str = Field(min_length=32, max_length=200)
    password: str = Field(min_length=12, max_length=72)


class ProGrantCreate(BaseModel):
    reason: str = Field(min_length=3, max_length=240)
    expires_at: datetime | None = None


class AccountStatusUpdate(BaseModel):
    is_active: bool
    reason: str = Field(min_length=3, max_length=240)


class AdminActionReason(BaseModel):
    reason: str = Field(min_length=3, max_length=240)


def database_session():
    yield from get_session(SessionLocal)


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def is_platform_admin(user: User) -> bool:
    return user.is_platform_admin


def require_platform_admin(
    user_id: UUID = Depends(require_user_id),
    session: Session = Depends(database_session),
) -> User:
    user = get_active_user(user_id, session)
    if not is_platform_admin(user):
        raise HTTPException(status_code=403, detail="Platform administrator access required")
    return user


def audit(session: Session, actor: User, action: str, target: User | None, details: dict) -> None:
    session.add(AdminAuditEvent(
        actor_user_id=actor.id,
        target_user_id=target.id if target else None,
        action=action,
        details=details,
    ))


def active_pro_grant(session: Session, user_id: str) -> ProGrant | None:
    now = utc_now()
    return session.scalar(select(ProGrant).where(
        ProGrant.user_id == user_id,
        ProGrant.revoked_at.is_(None),
        or_(ProGrant.expires_at.is_(None), ProGrant.expires_at > now),
    ).order_by(ProGrant.created_at.desc()))


def admin_user_response(session: Session, user: User) -> dict:
    grant = active_pro_grant(session, user.id)
    return {
        "id": user.id,
        "email": user.email,
        "display_name": user.display_name,
        "is_active": user.is_active,
        "is_pro": bool(user.is_pro or grant),
        "pro_source": "manual_grant" if grant else ("subscription" if user.is_pro else None),
        "active_pro_grant": ({
            "id": grant.id,
            "reason": grant.reason,
            "expires_at": grant.expires_at.isoformat() + "Z" if grant.expires_at else None,
            "created_at": grant.created_at.isoformat() + "Z",
        } if grant else None),
        "created_at": user.created_at.isoformat() + "Z",
    }


def issue_tokens(session: Session, user: User) -> dict[str, str | dict[str, str | bool]]:
    refresh_token = secrets.token_urlsafe(48)
    refresh_days = int(env("REFRESH_TOKEN_DAYS", "30"))
    session.add(RefreshSession(
        user_id=user.id,
        token_digest=digest(refresh_token),
        expires_at=utc_now() + timedelta(days=refresh_days),
    ))
    return {
        "access_token": create_access_token(UUID(user.id)),
        "token_type": "bearer",
        "expires_in": int(env("ACCESS_TOKEN_MINUTES", "15")) * 60,
        "refresh_token": refresh_token,
        "user": {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "is_pro": bool(user.is_pro or active_pro_grant(session, user.id)),
            "is_platform_admin": is_platform_admin(user),
        },
    }


def get_active_user(user_id: UUID, session: Session) -> User:
    user = session.get(User, str(user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    return user


@app.get("/health")
def health(session: Session = Depends(database_session)):
    session.execute(text("SELECT 1"))
    return {"status": "ok", "service": "auth"}


@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, session: Session = Depends(database_session)):
    encoded = payload.password.encode("utf-8")
    if len(encoded) > 72:
        raise HTTPException(status_code=422, detail="Password must be at most 72 UTF-8 bytes")
    email = str(payload.email).strip().lower()
    user = User(
        email=email,
        password_hash=bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=12)).decode("utf-8"),
        display_name=payload.display_name.strip(),
    )
    session.add(user)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists") from None
    response = issue_tokens(session, user)
    session.commit()
    return response


@app.post("/auth/login")
def login(payload: Credentials, session: Session = Depends(database_session)):
    user = session.scalar(select(User).where(User.email == str(payload.email).strip().lower()))
    valid = False
    if user is not None and user.is_active:
        try:
            valid = bcrypt.checkpw(payload.password.encode("utf-8"), user.password_hash.encode("utf-8"))
        except ValueError:
            valid = False
    if not valid or user is None:
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    response = issue_tokens(session, user)
    session.commit()
    return response


@app.post("/auth/refresh")
def refresh(payload: RefreshRequest, session: Session = Depends(database_session)):
    current = session.scalar(
        select(RefreshSession)
        .where(RefreshSession.token_digest == digest(payload.refresh_token))
        .with_for_update()
    )
    now = utc_now()
    if current is None or current.revoked_at is not None or current.expires_at <= now:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = get_active_user(UUID(current.user_id), session)
    current.revoked_at = now
    response = issue_tokens(session, user)
    session.commit()
    return response


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(payload: RefreshRequest, session: Session = Depends(database_session)):
    current = session.scalar(select(RefreshSession).where(RefreshSession.token_digest == digest(payload.refresh_token)))
    if current is not None and current.revoked_at is None:
        current.revoked_at = utc_now()
        session.commit()
    return None


@app.get("/auth/me")
def me(user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    user = get_active_user(user_id, session)
    grant = active_pro_grant(session, user.id)
    return {"id": user.id, "email": user.email, "display_name": user.display_name,
            "is_pro": bool(user.is_pro or grant), "is_platform_admin": is_platform_admin(user)}


@app.post("/auth/accept-invitation", status_code=status.HTTP_201_CREATED)
def accept_invitation(payload: InvitationAccept, session: Session = Depends(database_session)):
    encoded = payload.password.encode("utf-8")
    if len(encoded) > 72:
        raise HTTPException(status_code=422, detail="Password must be at most 72 UTF-8 bytes")
    invitation = session.scalar(select(AdminInvitation).where(
        AdminInvitation.token_digest == digest(payload.token),
    ).with_for_update())
    now = utc_now()
    if invitation is None or invitation.accepted_at is not None or invitation.expires_at <= now:
        raise HTTPException(status_code=400, detail="Invitation is invalid or expired")
    if session.scalar(select(User.id).where(User.email == invitation.email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(
        email=invitation.email,
        display_name=invitation.display_name,
        password_hash=bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=12)).decode("utf-8"),
    )
    session.add(user)
    session.flush()
    invitation.accepted_at = now
    audit(session, session.get(User, invitation.invited_by_user_id), "user.invitation_accepted", user,
          {"invitation_id": invitation.id, "email": user.email})
    response = issue_tokens(session, user)
    session.commit()
    return response


@app.get("/admin/summary")
def admin_summary(admin: User = Depends(require_platform_admin), session: Session = Depends(database_session)):
    now = utc_now()
    grant_user_ids = select(ProGrant.user_id).where(
        ProGrant.revoked_at.is_(None),
        or_(ProGrant.expires_at.is_(None), ProGrant.expires_at > now),
    )
    return {
        "users": session.scalar(select(func.count(User.id))) or 0,
        "active_users": session.scalar(select(func.count(User.id)).where(User.is_active.is_(True))) or 0,
        "pro_users": session.scalar(select(func.count(User.id)).where(or_(User.is_pro.is_(True), User.id.in_(grant_user_ids)))) or 0,
        "pending_invitations": session.scalar(select(func.count(AdminInvitation.id)).where(
            AdminInvitation.accepted_at.is_(None), AdminInvitation.expires_at > now,
        )) or 0,
    }


@app.get("/admin/users")
def admin_list_users(
    q: str = Query(default="", max_length=160),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    admin: User = Depends(require_platform_admin),
    session: Session = Depends(database_session),
):
    query = select(User)
    if q.strip():
        search = f"%{q.strip().lower()}%"
        query = query.where(or_(func.lower(User.email).like(search), func.lower(User.display_name).like(search)))
    total = session.scalar(select(func.count()).select_from(query.subquery())) or 0
    users = session.scalars(query.order_by(User.created_at.desc()).offset(offset).limit(limit)).all()
    return {"items": [admin_user_response(session, user) for user in users], "total": total, "limit": limit, "offset": offset}


@app.post("/admin/users/invitations", status_code=status.HTTP_201_CREATED)
def admin_create_invitation(payload: InvitationCreate, admin: User = Depends(require_platform_admin), session: Session = Depends(database_session)):
    email = str(payload.email).strip().lower()
    if session.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    now = utc_now()
    active_invitation = session.scalar(select(AdminInvitation).where(
        AdminInvitation.email == email,
        AdminInvitation.accepted_at.is_(None),
        AdminInvitation.expires_at > now,
    ))
    if active_invitation:
        raise HTTPException(status_code=409, detail="A valid invitation already exists for this email")
    token = secrets.token_urlsafe(40)
    expires_at = now + timedelta(days=7)
    invitation = AdminInvitation(
        email=email,
        display_name=payload.display_name.strip(),
        token_digest=digest(token),
        invited_by_user_id=admin.id,
        expires_at=expires_at,
    )
    session.add(invitation)
    session.flush()
    audit(session, admin, "user.invited", None, {"invitation_id": invitation.id, "email": email,
                                                   "expires_at": expires_at.isoformat() + "Z"})
    session.commit()
    return {"id": invitation.id, "email": email, "display_name": invitation.display_name,
            "invite_token": token, "expires_at": expires_at.isoformat() + "Z"}


@app.patch("/admin/users/{target_user_id}/status")
def admin_update_user_status(
    target_user_id: UUID,
    payload: AccountStatusUpdate,
    admin: User = Depends(require_platform_admin),
    session: Session = Depends(database_session),
):
    target = session.get(User, str(target_user_id))
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == admin.id and not payload.is_active:
        raise HTTPException(status_code=409, detail="You cannot suspend your own administrator account")
    if not payload.is_active and is_platform_admin(target):
        raise HTTPException(status_code=409, detail="Configured platform administrators cannot be suspended here")
    previous = target.is_active
    target.is_active = payload.is_active
    if not payload.is_active:
        session.query(RefreshSession).filter(
            RefreshSession.user_id == target.id,
            RefreshSession.revoked_at.is_(None),
        ).update({RefreshSession.revoked_at: utc_now()}, synchronize_session=False)
    audit(session, admin, "user.status_changed", target,
          {"from": previous, "to": target.is_active, "reason": payload.reason})
    session.commit()
    return admin_user_response(session, target)


@app.post("/admin/users/{target_user_id}/sessions/revoke")
def admin_revoke_user_sessions(
    target_user_id: UUID,
    payload: AdminActionReason,
    admin: User = Depends(require_platform_admin),
    session: Session = Depends(database_session),
):
    target = session.get(User, str(target_user_id))
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    revoked_count = session.query(RefreshSession).filter(
        RefreshSession.user_id == target.id,
        RefreshSession.revoked_at.is_(None),
    ).update({RefreshSession.revoked_at: utc_now()}, synchronize_session=False)
    audit(session, admin, "user.sessions_revoked", target,
          {"reason": payload.reason, "revoked_sessions": revoked_count})
    session.commit()
    return {"user_id": target.id, "revoked_sessions": revoked_count}


@app.post("/admin/users/{target_user_id}/pro-grants", status_code=status.HTTP_201_CREATED)
def admin_create_pro_grant(
    target_user_id: UUID,
    payload: ProGrantCreate,
    admin: User = Depends(require_platform_admin),
    session: Session = Depends(database_session),
):
    target = session.get(User, str(target_user_id))
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not target.is_active:
        raise HTTPException(status_code=409, detail="Reactivate the account before granting Pro")
    if active_pro_grant(session, target.id):
        raise HTTPException(status_code=409, detail="User already has an active Pro grant")
    expires_at = payload.expires_at
    if expires_at and expires_at.tzinfo:
        expires_at = expires_at.astimezone(timezone.utc).replace(tzinfo=None)
    grant = ProGrant(user_id=target.id, granted_by_user_id=admin.id,
                     reason=payload.reason.strip(), expires_at=expires_at)
    session.add(grant)
    session.flush()
    audit(session, admin, "pro.granted", target, {"grant_id": grant.id, "reason": grant.reason,
                                                   "expires_at": expires_at.isoformat() + "Z" if expires_at else None})
    session.commit()
    return admin_user_response(session, target)


@app.delete("/admin/users/{target_user_id}/pro-grants/{grant_id}")
def admin_revoke_pro_grant(
    target_user_id: UUID,
    grant_id: UUID,
    reason: str = Query(default="Revoked by platform admin", max_length=240),
    admin: User = Depends(require_platform_admin),
    session: Session = Depends(database_session),
):
    target = session.get(User, str(target_user_id))
    grant = session.scalar(select(ProGrant).where(ProGrant.id == str(grant_id), ProGrant.user_id == str(target_user_id)))
    if target is None or grant is None:
        raise HTTPException(status_code=404, detail="Pro grant not found")
    if grant.revoked_at is not None:
        raise HTTPException(status_code=409, detail="Pro grant is already revoked")
    grant.revoked_at = utc_now()
    grant.revoked_by_user_id = admin.id
    audit(session, admin, "pro.revoked", target, {"grant_id": grant.id, "reason": reason})
    session.commit()
    return admin_user_response(session, target)


@app.get("/admin/audit")
def admin_audit(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    admin: User = Depends(require_platform_admin),
    session: Session = Depends(database_session),
):
    rows = session.execute(
        select(AdminAuditEvent, User.email)
        .join(User, User.id == AdminAuditEvent.actor_user_id)
        .order_by(AdminAuditEvent.created_at.desc())
        .offset(offset).limit(limit)
    ).all()
    return [{"id": event.id, "actor_email": email, "target_user_id": event.target_user_id,
             "action": event.action, "details": event.details,
             "created_at": event.created_at.isoformat() + "Z"} for event, email in rows]


@app.get("/internal/users/{user_id}", dependencies=[Depends(require_internal_token)])
def internal_user(user_id: UUID, session: Session = Depends(database_session)):
    user = session.get(User, str(user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user.id, "display_name": user.display_name}


@app.post("/internal/users/lookup", dependencies=[Depends(require_internal_token)])
def internal_users_lookup(payload: UserLookup, session: Session = Depends(database_session)):
    requested = {str(user_id) for user_id in payload.user_ids}
    users = session.scalars(select(User).where(User.id.in_(requested), User.is_active.is_(True))).all()
    if {user.id for user in users} != requested:
        raise HTTPException(status_code=404, detail="One or more users were not found")
    return [{"id": user.id, "display_name": user.display_name} for user in users]
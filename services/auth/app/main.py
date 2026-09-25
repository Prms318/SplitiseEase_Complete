import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from services.auth.app.models import RefreshSession, User
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


def database_session():
    yield from get_session(SessionLocal)


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


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
        "user": {"id": user.id, "email": user.email, "display_name": user.display_name, "is_pro": user.is_pro},
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
    return {"id": user.id, "email": user.email, "display_name": user.display_name, "is_pro": user.is_pro}


@app.get("/internal/users/{user_id}", dependencies=[Depends(require_internal_token)])
def internal_user(user_id: UUID, session: Session = Depends(database_session)):
    user = session.get(User, str(user_id))
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user.id, "display_name": user.display_name}
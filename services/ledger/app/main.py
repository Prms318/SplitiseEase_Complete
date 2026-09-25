import hashlib
import json
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID, uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from services.common.app import configure_app
from services.common.config import env
from services.common.database import create_session_factory, get_session
from services.common.security import require_internal_token, require_user_id
from services.ledger.app.models import ChangeEvent, Expense, ExpenseSplit, Group, GroupMember, Settlement


engine, SessionLocal = create_session_factory()
app = FastAPI(title="SplitEase Ledger Service", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
configure_app(app)


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    member_ids: list[UUID] = Field(default_factory=list, max_length=99)

    @model_validator(mode="after")
    def unique_members(self):
        if len(self.member_ids) != len(set(self.member_ids)):
            raise ValueError("Group members must be unique")
        return self


class MemberAdd(BaseModel):
    user_id: UUID
    role: Literal["admin", "member"] = "member"


class SplitInput(BaseModel):
    user_id: UUID
    owed_minor: int = Field(ge=0, le=10**12)


class ExpenseCreate(BaseModel):
    client_mutation_id: UUID
    description: str = Field(min_length=1, max_length=240)
    amount_minor: int = Field(gt=0, le=10**12)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    split_method: Literal["equal", "exact"] = "exact"
    paid_by_user_id: UUID | None = None
    occurred_at: datetime | None = None
    splits: list[SplitInput] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_splits(self):
        ids = [item.user_id for item in self.splits]
        if len(ids) != len(set(ids)):
            raise ValueError("Each group member may appear once in splits")
        if sum(item.owed_minor for item in self.splits) != self.amount_minor:
            raise ValueError("Split amounts must add up to the expense total")
        return self


class FriendExpenseCreate(BaseModel):
    client_mutation_id: UUID
    description: str = Field(min_length=1, max_length=240)
    amount_minor: int = Field(gt=0, le=10**12)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    occurred_at: datetime | None = None


class SettlementCreate(BaseModel):
    idempotency_key: UUID
    payer_user_id: UUID
    payee_user_id: UUID
    amount_minor: int = Field(gt=0, le=10**12)
    currency: str = Field(pattern=r"^[A-Z]{3}$")


class SyncApply(BaseModel):
    actor_user_id: UUID
    mutation_id: UUID
    kind: Literal["group_expense.create", "friend_expense.create"]
    group_id: UUID | None = None
    friend_user_id: UUID | None = None
    description: str = Field(min_length=1, max_length=240)
    amount_minor: int = Field(gt=0, le=10**12)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    split_method: Literal["equal", "exact"] = "equal"
    paid_by_user_id: UUID | None = None
    occurred_at: datetime | None = None
    splits: list[SplitInput] = Field(default_factory=list, max_length=100)


class AccessTokenUser(BaseModel):
    user_id: UUID


def database_session():
    yield from get_session(SessionLocal)


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def require_member(session: Session, group_id: UUID, user_id: UUID) -> GroupMember:
    member = session.scalar(select(GroupMember).where(
        GroupMember.group_id == str(group_id),
        GroupMember.user_id == str(user_id),
        GroupMember.status == "active",
    ))
    if member is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return member


def require_known_user(user_id: UUID) -> dict[str, str]:
    try:
        response = httpx.get(
            f"{env('AUTH_SERVICE_URL', 'http://auth-service:8001')}/internal/users/{user_id}",
            headers={"X-Internal-Token": env("SERVICE_INTERNAL_TOKEN")},
            timeout=3.0,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Identity service is unavailable") from None
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="User not found")
    if response.is_error:
        raise HTTPException(status_code=503, detail="Identity service request failed")
    return response.json()


def ensure_members(session: Session, group_id: UUID, user_ids: set[UUID]) -> None:
    rows = session.scalars(select(GroupMember.user_id).where(
        GroupMember.group_id == str(group_id),
        GroupMember.status == "active",
        GroupMember.user_id.in_([str(item) for item in user_ids]),
    )).all()
    if set(rows) != {str(item) for item in user_ids}:
        raise HTTPException(status_code=422, detail="All payers and participants must be active group members")


def expense_digest(group_id: UUID, payload: dict) -> str:
    canonical = json.dumps({"group_id": str(group_id), **payload}, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def expense_response(expense: Expense, splits: list[ExpenseSplit]) -> dict:
    return {
        "id": expense.id,
        "group_id": expense.group_id,
        "description": expense.description,
        "amount_minor": expense.amount_minor,
        "currency": expense.currency,
        "paid_by_user_id": expense.paid_by_user_id,
        "split_method": expense.split_method,
        "occurred_at": utc_iso(expense.occurred_at),
        "client_mutation_id": expense.client_mutation_id,
        "splits": [{"user_id": split.user_id, "owed_minor": split.owed_minor} for split in splits],
    }


def create_expense_record(
    session: Session,
    group: Group,
    actor_user_id: UUID,
    payload: ExpenseCreate,
) -> dict:
    digest = expense_digest(group.id, payload.model_dump(mode="json"))
    existing = session.scalar(select(Expense).where(
        Expense.created_by_user_id == str(actor_user_id),
        Expense.client_mutation_id == str(payload.client_mutation_id),
    ))
    if existing is not None:
        if existing.payload_hash != digest:
            raise HTTPException(status_code=409, detail="Mutation ID was already used for a different expense")
        existing_splits = session.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id == existing.id)).all()
        return expense_response(existing, existing_splits)

    if payload.currency != group.currency:
        raise HTTPException(status_code=422, detail=f"This group uses {group.currency}; currency conversion is not enabled")
    payer_id = payload.paid_by_user_id or actor_user_id
    participants = {item.user_id for item in payload.splits} | {payer_id}
    ensure_members(session, UUID(group.id), participants)

    occurred_at = payload.occurred_at or datetime.now(timezone.utc)
    if occurred_at.tzinfo is None:
        raise HTTPException(status_code=422, detail="occurred_at must include a timezone")
    expense = Expense(
        group_id=group.id,
        created_by_user_id=str(actor_user_id),
        paid_by_user_id=str(payer_id),
        client_mutation_id=str(payload.client_mutation_id),
        payload_hash=digest,
        description=payload.description.strip(),
        amount_minor=payload.amount_minor,
        currency=payload.currency,
        split_method=payload.split_method,
        occurred_at=occurred_at.astimezone(timezone.utc).replace(tzinfo=None),
    )
    session.add(expense)
    session.flush()
    splits = [ExpenseSplit(expense_id=expense.id, user_id=str(item.user_id), owed_minor=item.owed_minor) for item in payload.splits]
    session.add_all(splits)
    response = expense_response(expense, splits)
    session.add(ChangeEvent(group_id=group.id, event_type="expense.created", entity_id=expense.id, payload=response))
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.scalar(select(Expense).where(
            Expense.created_by_user_id == str(actor_user_id),
            Expense.client_mutation_id == str(payload.client_mutation_id),
        ))
        if existing is None:
            raise HTTPException(status_code=409, detail="Expense could not be recorded") from None
        if existing.payload_hash != digest:
            raise HTTPException(status_code=409, detail="Mutation ID was already used for a different expense")
        splits = session.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id == existing.id)).all()
        return expense_response(existing, splits)
    return response


def make_equal_splits(amount_minor: int, member_ids: list[UUID]) -> list[SplitInput]:
    ordered = sorted(member_ids, key=str)
    base, remainder = divmod(amount_minor, len(ordered))
    return [SplitInput(user_id=user_id, owed_minor=base + (1 if index < remainder else 0)) for index, user_id in enumerate(ordered)]


def find_or_create_friend_group(session: Session, actor_id: UUID, friend_id: UUID) -> Group:
    if actor_id == friend_id:
        raise HTTPException(status_code=422, detail="You cannot create a friend group with yourself")
    require_known_user(friend_id)
    pair_key = ":".join(sorted((str(actor_id), str(friend_id))))
    group = session.scalar(select(Group).where(Group.direct_pair_key == pair_key))
    if group is not None:
        require_member(session, UUID(group.id), actor_id)
        return group

    group = Group(
        name="Direct expenses",
        kind="friend",
        direct_pair_key=pair_key,
        currency="USD",
        created_by_user_id=str(actor_id),
    )
    session.add(group)
    try:
        session.flush()
        session.add_all([
            GroupMember(group_id=group.id, user_id=str(actor_id), role="owner"),
            GroupMember(group_id=group.id, user_id=str(friend_id), role="member"),
        ])
        session.flush()
    except IntegrityError:
        session.rollback()
        group = session.scalar(select(Group).where(Group.direct_pair_key == pair_key))
        if group is None:
            raise HTTPException(status_code=409, detail="Could not create friend expense group") from None
    return group


@app.get("/health")
def health(session: Session = Depends(database_session)):
    session.execute(text("SELECT 1"))
    return {"status": "ok", "service": "ledger"}


@app.post("/api/v1/groups", status_code=status.HTTP_201_CREATED)
def create_group(payload: GroupCreate, user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    requested = set(payload.member_ids) | {user_id}
    for member_id in requested - {user_id}:
        require_known_user(member_id)
    group = Group(name=payload.name.strip(), kind="group", currency=payload.currency, created_by_user_id=str(user_id))
    session.add(group)
    session.flush()
    session.add_all([
        GroupMember(group_id=group.id, user_id=str(member_id), role="owner" if member_id == user_id else "member")
        for member_id in requested
    ])
    session.commit()
    return {"id": group.id, "name": group.name, "kind": group.kind, "currency": group.currency, "member_count": len(requested)}


@app.get("/api/v1/groups")
def list_groups(user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    rows = session.execute(
        select(Group, func.count(GroupMember.id))
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == str(user_id), GroupMember.status == "active")
        .group_by(Group.id)
        .order_by(Group.created_at.desc())
    ).all()
    return [{"id": group.id, "name": group.name, "kind": group.kind, "currency": group.currency,
             "member_count": count, "created_at": utc_iso(group.created_at)} for group, count in rows]


@app.post("/api/v1/groups/{group_id}/members", status_code=status.HTTP_201_CREATED)
def add_group_member(group_id: UUID, payload: MemberAdd, user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    actor = require_member(session, group_id, user_id)
    if actor.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Group admin role required")
    group = session.get(Group, str(group_id))
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.kind == "friend":
        raise HTTPException(status_code=409, detail="Direct friend ledgers are limited to two people")
    require_known_user(payload.user_id)
    current = session.scalar(select(GroupMember).where(GroupMember.group_id == str(group_id), GroupMember.user_id == str(payload.user_id)))
    if current is not None and current.status == "active":
        raise HTTPException(status_code=409, detail="User is already a group member")
    if current is not None:
        current.status = "active"
        current.role = payload.role
        current.joined_at = utc_now()
    else:
        session.add(GroupMember(group_id=str(group_id), user_id=str(payload.user_id), role=payload.role))
    session.commit()
    return {"group_id": str(group_id), "user_id": str(payload.user_id), "role": payload.role, "status": "active"}


@app.post("/api/v1/groups/{group_id}/expenses", status_code=status.HTTP_201_CREATED)
def create_group_expense(group_id: UUID, payload: ExpenseCreate, user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    require_member(session, group_id, user_id)
    group = session.get(Group, str(group_id))
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return create_expense_record(session, group, user_id, payload)


@app.post("/api/v1/friends/{friend_user_id}/expenses", status_code=status.HTTP_201_CREATED)
def create_friend_expense(friend_user_id: UUID, payload: FriendExpenseCreate, user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    group = find_or_create_friend_group(session, user_id, friend_user_id)
    if payload.currency != group.currency:
        raise HTTPException(status_code=422, detail=f"This friend ledger uses {group.currency}")
    draft = ExpenseCreate(
        client_mutation_id=payload.client_mutation_id,
        description=payload.description,
        amount_minor=payload.amount_minor,
        currency=payload.currency,
        split_method="equal",
        paid_by_user_id=user_id,
        occurred_at=payload.occurred_at,
        splits=make_equal_splits(payload.amount_minor, [user_id, friend_user_id]),
    )
    result = create_expense_record(session, group, user_id, draft)
    return {**result, "friend_user_id": str(friend_user_id)}


@app.get("/api/v1/groups/{group_id}/expenses")
def list_expenses(group_id: UUID, limit: int = Query(default=50, ge=1, le=100), user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    require_member(session, group_id, user_id)
    rows = session.scalars(
        select(Expense).where(Expense.group_id == str(group_id), Expense.reversed_at.is_(None))
        .order_by(Expense.occurred_at.desc(), Expense.id.desc()).limit(limit)
    ).all()
    return [{**expense_response(row, session.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id == row.id)).all()),
             "created_at": utc_iso(row.created_at)} for row in rows]


@app.get("/api/v1/groups/{group_id}/balances")
def get_balances(group_id: UUID, user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    require_member(session, group_id, user_id)
    members = session.scalars(select(GroupMember.user_id).where(GroupMember.group_id == str(group_id), GroupMember.status == "active")).all()
    net = {member_id: 0 for member_id in members}
    expenses = session.scalars(select(Expense).where(Expense.group_id == str(group_id), Expense.reversed_at.is_(None))).all()
    for expense in expenses:
        net[expense.paid_by_user_id] = net.get(expense.paid_by_user_id, 0) + expense.amount_minor
        for split in session.scalars(select(ExpenseSplit).where(ExpenseSplit.expense_id == expense.id)).all():
            net[split.user_id] = net.get(split.user_id, 0) - split.owed_minor
    settlements = session.scalars(select(Settlement).where(Settlement.group_id == str(group_id), Settlement.status.in_(["recorded", "succeeded"]))).all()
    for settlement in settlements:
        net[settlement.payer_user_id] = net.get(settlement.payer_user_id, 0) + settlement.amount_minor
        net[settlement.payee_user_id] = net.get(settlement.payee_user_id, 0) - settlement.amount_minor
    group = session.get(Group, str(group_id))
    return {"group_id": str(group_id), "currency": group.currency if group else "USD",
            "balances": [{"user_id": member_id, "net_minor": value} for member_id, value in sorted(net.items())]}


@app.post("/api/v1/groups/{group_id}/settlements", status_code=status.HTTP_201_CREATED)
def create_settlement(group_id: UUID, payload: SettlementCreate, user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    require_member(session, group_id, user_id)
    if user_id not in {payload.payer_user_id, payload.payee_user_id}:
        raise HTTPException(status_code=403, detail="Only a settlement participant can record this settlement")
    if payload.payer_user_id == payload.payee_user_id:
        raise HTTPException(status_code=422, detail="Settlement parties must be different")
    ensure_members(session, group_id, {payload.payer_user_id, payload.payee_user_id})
    group = session.get(Group, str(group_id))
    if group is None or payload.currency != group.currency:
        raise HTTPException(status_code=422, detail="Settlement currency must match the group currency")
    existing = session.scalar(select(Settlement).where(Settlement.created_by_user_id == str(user_id), Settlement.idempotency_key == str(payload.idempotency_key)))
    if existing is not None:
        if (existing.group_id, existing.payer_user_id, existing.payee_user_id, existing.amount_minor) != (str(group_id), str(payload.payer_user_id), str(payload.payee_user_id), payload.amount_minor):
            raise HTTPException(status_code=409, detail="Idempotency key was already used")
        return {"id": existing.id, "status": existing.status, "amount_minor": existing.amount_minor}

    balances = get_balances(group_id, user_id, session)["balances"]
    net = {item["user_id"]: item["net_minor"] for item in balances}
    if net.get(str(payload.payer_user_id), 0) >= 0 or net.get(str(payload.payee_user_id), 0) <= 0:
        raise HTTPException(status_code=422, detail="Settlement direction does not match the current balances")
    if payload.amount_minor > min(-net[str(payload.payer_user_id)], net[str(payload.payee_user_id)]):
        raise HTTPException(status_code=422, detail="Settlement exceeds the outstanding debt")
    settlement = Settlement(
        group_id=str(group_id), created_by_user_id=str(user_id), payer_user_id=str(payload.payer_user_id),
        payee_user_id=str(payload.payee_user_id), idempotency_key=str(payload.idempotency_key),
        amount_minor=payload.amount_minor, currency=payload.currency, status="recorded",
    )
    session.add(settlement)
    session.flush()
    session.add(ChangeEvent(group_id=str(group_id), event_type="settlement.recorded", entity_id=settlement.id,
                            payload={"id": settlement.id, "group_id": str(group_id), "payer_user_id": str(payload.payer_user_id),
                                     "payee_user_id": str(payload.payee_user_id), "amount_minor": payload.amount_minor, "currency": payload.currency}))
    session.commit()
    return {"id": settlement.id, "status": settlement.status, "amount_minor": settlement.amount_minor, "currency": settlement.currency}


@app.post("/internal/sync/apply", dependencies=[Depends(require_internal_token)])
def apply_sync_mutation(payload: SyncApply, session: Session = Depends(database_session)):
    actor_id = payload.actor_user_id
    if payload.kind == "friend_expense.create":
        if payload.friend_user_id is None:
            raise HTTPException(status_code=422, detail="friend_user_id is required")
        group = find_or_create_friend_group(session, actor_id, payload.friend_user_id)
        if payload.currency != group.currency:
            raise HTTPException(status_code=422, detail=f"This friend ledger uses {group.currency}")
        splits = make_equal_splits(payload.amount_minor, [actor_id, payload.friend_user_id])
        draft = ExpenseCreate(client_mutation_id=payload.mutation_id, description=payload.description, amount_minor=payload.amount_minor,
                              currency=payload.currency, split_method="equal", paid_by_user_id=actor_id, occurred_at=payload.occurred_at, splits=splits)
    else:
        if payload.group_id is None:
            raise HTTPException(status_code=422, detail="group_id is required")
        require_member(session, payload.group_id, actor_id)
        group = session.get(Group, str(payload.group_id))
        if group is None:
            raise HTTPException(status_code=404, detail="Group not found")
        if not payload.splits:
            raise HTTPException(status_code=422, detail="Group expense sync requires explicit split amounts")
        draft = ExpenseCreate(client_mutation_id=payload.mutation_id, description=payload.description, amount_minor=payload.amount_minor,
                              currency=payload.currency, split_method=payload.split_method, paid_by_user_id=payload.paid_by_user_id,
                              occurred_at=payload.occurred_at, splits=payload.splits)
    return create_expense_record(session, group, actor_id, draft)


@app.get("/internal/sync/changes", dependencies=[Depends(require_internal_token)])
def sync_changes(user_id: UUID, cursor: int = Query(default=0, ge=0), limit: int = Query(default=200, ge=1, le=500), session: Session = Depends(database_session)):
    group_ids = session.scalars(select(GroupMember.group_id).where(GroupMember.user_id == str(user_id), GroupMember.status == "active")).all()
    if not group_ids:
        return {"cursor": cursor, "changes": []}
    rows = session.scalars(select(ChangeEvent).where(ChangeEvent.id > cursor).order_by(ChangeEvent.id).limit(limit)).all()
    next_cursor = rows[-1].id if rows else cursor
    visible = [row for row in rows if row.group_id in set(group_ids)]
    return {"cursor": next_cursor, "changes": [{"cursor": row.id, "group_id": row.group_id, "type": row.event_type,
                                                   "entity_id": row.entity_id, "data": row.payload,
                                                   "created_at": utc_iso(row.created_at)} for row in visible]}
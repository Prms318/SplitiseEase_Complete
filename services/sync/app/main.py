import hashlib
import json
from typing import Literal
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from redis import Redis
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from services.common.app import configure_app
from services.common.config import env
from services.common.database import create_session_factory, get_session
from services.common.security import require_user_id
from services.sync.app.models import SyncMutation


engine, SessionLocal = create_session_factory()
redis = Redis.from_url(env("REDIS_URL", "redis://localhost:6379/0"), decode_responses=True, socket_connect_timeout=2)
ledger_url = env("LEDGER_SERVICE_URL", "http://ledger-service:8002")
internal_headers = {"X-Internal-Token": env("SERVICE_INTERNAL_TOKEN")}
app = FastAPI(title="SplitEase Sync Service", version="1.0.0", docs_url="/sync/docs", openapi_url="/sync/openapi.json", redoc_url=None)
configure_app(app)


class SplitInput(BaseModel):
    user_id: UUID
    owed_minor: int = Field(ge=0, le=10**12)


class OfflineMutation(BaseModel):
    client_mutation_id: UUID
    kind: Literal["group_expense.create", "friend_expense.create"]
    group_id: UUID | None = None
    friend_user_id: UUID | None = None
    description: str = Field(min_length=1, max_length=240)
    amount_minor: int = Field(gt=0, le=10**12)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    split_method: Literal["equal", "exact"] = "equal"
    paid_by_user_id: UUID | None = None
    occurred_at: str | None = None
    splits: list[SplitInput] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_target(self):
        if self.kind == "group_expense.create" and self.group_id is None:
            raise ValueError("group_id is required for a group expense")
        if self.kind == "friend_expense.create" and self.friend_user_id is None:
            raise ValueError("friend_user_id is required for a friend expense")
        return self


class PushRequest(BaseModel):
    device_id: UUID
    mutations: list[OfflineMutation] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_mutation_ids(self):
        ids = [mutation.client_mutation_id for mutation in self.mutations]
        if len(ids) != len(set(ids)):
            raise ValueError("A push batch cannot repeat a mutation ID")
        return self


def database_session():
    yield from get_session(SessionLocal)


def request_hash(mutation: OfflineMutation) -> str:
    value = json.dumps(mutation.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def mutation_response(row: SyncMutation) -> dict:
    result = {"client_mutation_id": row.client_mutation_id, "status": row.status}
    if row.response_json is not None:
        result["result"] = row.response_json
    if row.error_detail:
        result["error"] = row.error_detail
    return result


def execute_mutation(session: Session, user_id: UUID, mutation: OfflineMutation) -> dict:
    digest = request_hash(mutation)
    row = session.scalar(select(SyncMutation).where(
        SyncMutation.user_id == str(user_id),
        SyncMutation.client_mutation_id == str(mutation.client_mutation_id),
    ))
    if row is not None:
        if row.request_hash != digest:
            raise HTTPException(status_code=409, detail=f"Mutation ID {mutation.client_mutation_id} was reused with different content")
        if row.status in {"completed", "rejected"}:
            return mutation_response(row)
    else:
        row = SyncMutation(
            user_id=str(user_id),
            client_mutation_id=str(mutation.client_mutation_id),
            request_hash=digest,
            status="pending",
        )
        session.add(row)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            row = session.scalar(select(SyncMutation).where(
                SyncMutation.user_id == str(user_id),
                SyncMutation.client_mutation_id == str(mutation.client_mutation_id),
            ))
            if row is None or row.request_hash != digest:
                raise HTTPException(status_code=409, detail="Concurrent sync mutation conflict") from None
            if row.status in {"completed", "rejected"}:
                return mutation_response(row)

    command = {
        "actor_user_id": str(user_id),
        "mutation_id": str(mutation.client_mutation_id),
        **mutation.model_dump(mode="json", exclude={"client_mutation_id"}),
    }
    try:
        response = httpx.post(f"{ledger_url}/internal/sync/apply", json=command, headers=internal_headers, timeout=10.0)
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Ledger service is unavailable; retry this mutation") from None

    if response.is_error:
        row.status = "rejected" if response.status_code < 500 else "pending"
        row.error_detail = response.json().get("detail", "Ledger rejected the mutation")
        session.commit()
        if row.status == "pending":
            raise HTTPException(status_code=503, detail="Ledger service is temporarily unavailable; retry this mutation")
        return mutation_response(row)

    result = response.json()
    row.status = "completed"
    row.response_json = result
    row.error_detail = None
    session.commit()
    try:
        redis.publish(f"splitease:user:{user_id}:changes", json.dumps({"type": "sync.completed", "client_mutation_id": str(mutation.client_mutation_id)}))
    except Exception:
        pass
    return mutation_response(row)


@app.get("/health")
def health(session: Session = Depends(database_session)):
    session.execute(text("SELECT 1"))
    redis.ping()
    return {"status": "ok", "service": "sync"}


@app.post("/sync/push")
def push(payload: PushRequest, user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    results = [execute_mutation(session, user_id, mutation) for mutation in payload.mutations]
    return {"device_id": str(payload.device_id), "results": results}


@app.get("/sync/pull")
def pull(cursor: int = Query(default=0, ge=0), limit: int = Query(default=200, ge=1, le=500), user_id: UUID = Depends(require_user_id)):
    try:
        response = httpx.get(
            f"{ledger_url}/internal/sync/changes",
            params={"user_id": str(user_id), "cursor": cursor, "limit": limit},
            headers=internal_headers,
            timeout=10.0,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Ledger service is unavailable") from None
    if response.is_error:
        raise HTTPException(status_code=502, detail="Could not retrieve changes")
    return response.json()


@app.get("/sync/mutations/{client_mutation_id}")
def mutation_status(client_mutation_id: UUID, user_id: UUID = Depends(require_user_id), session: Session = Depends(database_session)):
    row = session.scalar(select(SyncMutation).where(
        SyncMutation.user_id == str(user_id),
        SyncMutation.client_mutation_id == str(client_mutation_id),
    ))
    if row is None:
        raise HTTPException(status_code=404, detail="Mutation not found")
    return mutation_response(row)
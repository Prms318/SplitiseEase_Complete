from datetime import datetime
from uuid import uuid4

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from services.common.database import Base


class Group(Base):
    __tablename__ = "groups"
    __table_args__ = (
        CheckConstraint("kind IN ('group', 'friend')", name="ck_groups_kind"),
        CheckConstraint("length(currency) = 3", name="ck_groups_currency"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(12), nullable=False, default="group")
    direct_pair_key: Mapped[str | None] = mapped_column(String(73), unique=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", name="uq_group_members_group_user"),
        CheckConstraint("role IN ('owner', 'admin', 'member')", name="ck_group_members_role"),
        CheckConstraint("status IN ('active', 'removed')", name="ck_group_members_status"),
        Index("ix_group_members_user_status", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    group_id: Mapped[str] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="member")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="active")
    joined_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_expenses_amount_positive"),
        CheckConstraint("split_method IN ('equal', 'exact')", name="ck_expenses_split_method"),
        UniqueConstraint("created_by_user_id", "client_mutation_id", name="uq_expenses_client_mutation"),
        Index("ix_expenses_group_created", "group_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    group_id: Mapped[str] = mapped_column(ForeignKey("groups.id", ondelete="RESTRICT"), nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    paid_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    client_mutation_id: Mapped[str | None] = mapped_column(String(36))
    payload_hash: Mapped[str | None] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(240), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    split_method: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
    reversed_at: Mapped[datetime | None] = mapped_column(DateTime)


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"
    __table_args__ = (
        UniqueConstraint("expense_id", "user_id", name="uq_expense_splits_expense_user"),
        CheckConstraint("owed_minor >= 0", name="ck_expense_splits_owed_nonnegative"),
        Index("ix_expense_splits_user", "user_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    expense_id: Mapped[str] = mapped_column(ForeignKey("expenses.id", ondelete="RESTRICT"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    owed_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


class Settlement(Base):
    __tablename__ = "settlements"
    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_settlements_amount_positive"),
        CheckConstraint("payer_user_id <> payee_user_id", name="ck_settlements_distinct_users"),
        CheckConstraint("status IN ('recorded', 'succeeded', 'reversed')", name="ck_settlements_status"),
        UniqueConstraint("created_by_user_id", "idempotency_key", name="uq_settlement_idempotency"),
        Index("ix_settlements_group_created", "group_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    group_id: Mapped[str] = mapped_column(ForeignKey("groups.id", ondelete="RESTRICT"), nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    payer_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    payee_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(36), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="recorded")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())


class ChangeEvent(Base):
    __tablename__ = "change_events"
    __table_args__ = (Index("ix_change_events_group_id", "group_id", "id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    group_id: Mapped[str] = mapped_column(String(36), nullable=False)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.now())
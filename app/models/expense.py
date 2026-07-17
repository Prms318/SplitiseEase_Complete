import uuid
from sqlalchemy import (
    Column, String, Numeric, Boolean, Date, DateTime,
    ForeignKey, CheckConstraint, UniqueConstraint, func
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (CheckConstraint("amount > 0", name="ck_expense_amount_positive"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)
    description = Column(String(255), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="USD")
    paid_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    split_type = Column(String(20), nullable=False, default="equal")
    expense_date = Column(Date, nullable=False)
    notes = Column(String)
    is_deleted = Column(Boolean, default=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    payers = relationship("ExpensePayer", cascade="all, delete-orphan", backref="expense")
    splits = relationship("ExpenseSplit", cascade="all, delete-orphan", backref="expense")


class ExpensePayer(Base):
    __tablename__ = "expense_payers"
    __table_args__ = (UniqueConstraint("expense_id", "user_id", name="uq_expense_payer"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    expense_id = Column(UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount_paid = Column(Numeric(12, 2), nullable=False)


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"
    __table_args__ = (UniqueConstraint("expense_id", "user_id", name="uq_expense_split"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    expense_id = Column(UUID(as_uuid=True), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount_owed = Column(Numeric(12, 2), nullable=False)
    percentage = Column(Numeric(5, 2))
    shares = Column(Numeric)
    is_settled = Column(Boolean, default=False)

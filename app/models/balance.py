import uuid
from sqlalchemy import Column, String, Numeric, DateTime, ForeignKey, CheckConstraint, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class Balance(Base):
    __tablename__ = "balances"
    __table_args__ = (
        UniqueConstraint("group_id", "user_id", "owed_to", "currency", name="uq_balance"),
        CheckConstraint("user_id != owed_to", name="ck_balance_different_users"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    owed_to = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False, default=0)
    currency = Column(String(3), nullable=False, default="USD")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

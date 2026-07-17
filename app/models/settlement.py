import uuid
from sqlalchemy import Column, String, Numeric, DateTime, ForeignKey, CheckConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class Settlement(Base):
    __tablename__ = "settlements"
    __table_args__ = (CheckConstraint("paid_by != paid_to", name="ck_settlement_different_users"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id = Column(UUID(as_uuid=True), ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)
    paid_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    paid_to = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(3), nullable=False, default="USD")
    payment_method = Column(String(30))
    status = Column(String(20), default="completed")
    notes = Column(String)
    settled_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

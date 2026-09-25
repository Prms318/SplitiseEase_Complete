"""Create the Ledger service's initial schema."""

from alembic import op
import sqlalchemy as sa

revision = "ledger_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "groups",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("direct_pair_key", sa.String(73), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("kind IN ('group', 'friend')", name="ck_groups_kind"),
        sa.CheckConstraint("length(currency) = 3", name="ck_groups_currency"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("direct_pair_key"),
    )
    op.create_index("ix_groups_created_by_user_id", "groups", ["created_by_user_id"])

    op.create_table(
        "group_members",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("group_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("status", sa.String(12), nullable=False),
        sa.Column("joined_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("role IN ('owner', 'admin', 'member')", name="ck_group_members_role"),
        sa.CheckConstraint("status IN ('active', 'removed')", name="ck_group_members_status"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("group_id", "user_id", name="uq_group_members_group_user"),
    )
    op.create_index("ix_group_members_user_status", "group_members", ["user_id", "status"])

    op.create_table(
        "expenses",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("group_id", sa.String(36), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("paid_by_user_id", sa.String(36), nullable=False),
        sa.Column("client_mutation_id", sa.String(36), nullable=True),
        sa.Column("payload_hash", sa.String(64), nullable=True),
        sa.Column("description", sa.String(240), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("split_method", sa.String(16), nullable=False),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("reversed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("amount_minor > 0", name="ck_expenses_amount_positive"),
        sa.CheckConstraint("split_method IN ('equal', 'exact')", name="ck_expenses_split_method"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("created_by_user_id", "client_mutation_id", name="uq_expenses_client_mutation"),
    )
    op.create_index("ix_expenses_group_created", "expenses", ["group_id", "created_at"])

    op.create_table(
        "expense_splits",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("expense_id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("owed_minor", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("owed_minor >= 0", name="ck_expense_splits_owed_nonnegative"),
        sa.ForeignKeyConstraint(["expense_id"], ["expenses.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("expense_id", "user_id", name="uq_expense_splits_expense_user"),
    )
    op.create_index("ix_expense_splits_user", "expense_splits", ["user_id"])

    op.create_table(
        "settlements",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("group_id", sa.String(36), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("payer_user_id", sa.String(36), nullable=False),
        sa.Column("payee_user_id", sa.String(36), nullable=False),
        sa.Column("idempotency_key", sa.String(36), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("amount_minor > 0", name="ck_settlements_amount_positive"),
        sa.CheckConstraint("payer_user_id <> payee_user_id", name="ck_settlements_distinct_users"),
        sa.CheckConstraint("status IN ('recorded', 'succeeded', 'reversed')", name="ck_settlements_status"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("created_by_user_id", "idempotency_key", name="uq_settlement_idempotency"),
    )
    op.create_index("ix_settlements_group_created", "settlements", ["group_id", "created_at"])

    op.create_table(
        "change_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.String(36), nullable=False),
        sa.Column("event_type", sa.String(48), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_change_events_group_id", "change_events", ["group_id", "id"])


def downgrade() -> None:
    op.drop_table("change_events")
    op.drop_index("ix_settlements_group_created", table_name="settlements")
    op.drop_table("settlements")
    op.drop_index("ix_expense_splits_user", table_name="expense_splits")
    op.drop_table("expense_splits")
    op.drop_index("ix_expenses_group_created", table_name="expenses")
    op.drop_table("expenses")
    op.drop_index("ix_group_members_user_status", table_name="group_members")
    op.drop_table("group_members")
    op.drop_index("ix_groups_created_by_user_id", table_name="groups")
    op.drop_table("groups")
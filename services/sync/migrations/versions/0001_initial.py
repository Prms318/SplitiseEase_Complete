"""Create the Sync service's initial schema."""

from alembic import op
import sqlalchemy as sa

revision = "sync_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sync_mutations",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("client_mutation_id", sa.String(36), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("response_json", sa.JSON(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "client_mutation_id", name="uq_sync_user_mutation"),
    )
    op.create_index("ix_sync_mutations_user_id", "sync_mutations", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_sync_mutations_user_id", table_name="sync_mutations")
    op.drop_table("sync_mutations")
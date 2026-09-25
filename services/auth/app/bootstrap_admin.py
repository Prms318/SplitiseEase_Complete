import argparse

from sqlalchemy import select

from services.auth.app.models import AdminAuditEvent, User
from services.common.database import create_session_factory


_, SessionLocal = create_session_factory()


def main() -> None:
    parser = argparse.ArgumentParser(description="Grant platform-admin access to an existing account.")
    parser.add_argument("email", help="Existing account email to grant administrator access to")
    args = parser.parse_args()
    email = args.email.strip().lower()

    with SessionLocal.begin() as session:
        user = session.scalar(select(User).where(User.email == email).with_for_update())
        if user is None:
            raise SystemExit(f"No user found for {email}. Create/sign up that account first.")
        if not user.is_active:
            raise SystemExit("Cannot grant admin access to a suspended account.")
        if not user.is_platform_admin:
            user.is_platform_admin = True
            session.add(AdminAuditEvent(
                actor_user_id=user.id,
                target_user_id=user.id,
                action="platform_admin.bootstrapped",
                details={"email": user.email, "source": "local_operator_command"},
            ))
            print(f"Platform admin enabled for {user.email}.")
        else:
            print(f"{user.email} already has platform-admin access.")


if __name__ == "__main__":
    main()

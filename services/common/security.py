import hmac
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
import httpx
from fastapi import Header, HTTPException, status

from services.common.config import env


def create_access_token(user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": str(user_id),
            "iss": env("JWT_ISSUER", "splitease-auth"),
            "iat": now,
            "exp": now + timedelta(minutes=int(env("ACCESS_TOKEN_MINUTES", "15"))),
            "typ": "access",
        },
        env("JWT_SECRET"),
        algorithm="HS256",
    )


def require_user_id(authorization: str | None = Header(default=None)) -> UUID:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not authorization or not authorization.startswith("Bearer "):
        raise unauthorized
    try:
        claims = jwt.decode(
            authorization[7:],
            env("JWT_SECRET"),
            algorithms=["HS256"],
            issuer=env("JWT_ISSUER", "splitease-auth"),
            options={"require": ["sub", "iss", "iat", "exp", "typ"]},
        )
        if claims.get("typ") != "access":
            raise unauthorized
        user_id = UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise unauthorized from None

    try:
        response = httpx.get(
            f"{env('AUTH_SERVICE_URL', 'http://auth-service:8001')}/internal/users/{user_id}",
            headers={"X-Internal-Token": env("SERVICE_INTERNAL_TOKEN")},
            timeout=2.0,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Authentication service is unavailable") from None
    if response.status_code == 404:
        raise unauthorized
    if response.is_error:
        raise HTTPException(status_code=503, detail="Authentication service validation failed")
    return user_id


def require_internal_token(token: str | None = Header(default=None, alias="X-Internal-Token")) -> None:
    expected = env("SERVICE_INTERNAL_TOKEN")
    if not token or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="Forbidden")
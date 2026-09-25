from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from services.common.config import cors_origins


def configure_app(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Internal-Token"],
    )
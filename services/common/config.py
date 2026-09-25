import os


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def cors_origins() -> list[str]:
    return [origin.strip() for origin in env("CORS_ORIGINS", "http://localhost:5173").split(",") if origin.strip()]
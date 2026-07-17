from fastapi import FastAPI
from app.api.routers import health

app = FastAPI(title="SplitEase API", version="0.1.0")

app.include_router(health.router, tags=["health"])


@app.get("/")
def root():
    return {"message": "SplitEase API is running"}

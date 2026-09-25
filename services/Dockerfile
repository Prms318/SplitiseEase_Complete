FROM python:3.12-slim

ARG SERVICE_NAME
LABEL org.opencontainers.image.title="SplitEase ${SERVICE_NAME} service"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app
COPY services/requirements.txt /app/services/requirements.txt
RUN pip install --no-cache-dir -r /app/services/requirements.txt
COPY services /app/services

EXPOSE 8000
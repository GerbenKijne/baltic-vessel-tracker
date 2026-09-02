# Build context is the repo root (see infra/compose/docker-compose.yml).
FROM python:3.12-slim AS base

WORKDIR /app

COPY workers/ingest/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY workers/ingest/worker ./worker
COPY packages/contracts/python ./contracts

ENV PYTHONPATH=/app:/app/contracts

RUN useradd --create-home --uid 1000 appuser
USER appuser

CMD ["python", "-m", "worker.main"]

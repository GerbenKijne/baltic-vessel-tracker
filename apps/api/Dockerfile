# Build context is the repo root (see infra/compose/docker-compose.yml) so this
# image can also vendor packages/contracts/python without a package registry.
FROM python:3.12-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/app ./app
COPY apps/api/migrations ./migrations
COPY apps/api/alembic.ini .
COPY packages/contracts/python ./contracts

ENV PYTHONPATH=/app:/app/contracts

RUN useradd --create-home --uid 1000 appuser
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

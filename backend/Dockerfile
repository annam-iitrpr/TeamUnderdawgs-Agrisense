# Cloud Run image for the AgriSense platform API.
FROM python:3.12-slim AS build
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /usr/local/bin/uv
WORKDIR /app
# Dependencies resolve from the committed lock, so an image cannot drift from what CI tested.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/agrisense ./agrisense
COPY backend/migrations ./migrations
COPY backend/alembic.ini ./alembic.ini
# Reviewed science reference records. These must ship with the image: without
# them every reviewed-parameter lookup fails and the API reports water and crop
# figures as unavailable — correct behaviour for missing data, and badly wrong
# as the result of a packaging omission. `test_reference_files_are_discoverable`
# fails if this copy is dropped.
COPY science/reference ./science/reference
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
# Runs unprivileged; the container filesystem is read-only in the service definition.
RUN useradd --system --uid 10001 --create-home agrisense
WORKDIR /app
COPY --from=build --chown=agrisense:agrisense /app /app
USER 10001
EXPOSE 8080
# Cloud Run terminates TLS and sets PORT; workers stay at one per instance so the
# connection pool is sized by instance count rather than by hidden process forks.
CMD ["sh", "-c", "exec uvicorn agrisense.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]

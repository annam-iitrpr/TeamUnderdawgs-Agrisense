"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from agrisense.api.errors import register_error_handlers
from agrisense.api.routes import router
from agrisense.config import get_settings
from agrisense.models.db import init_db

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="AgriSense",
    description="Biological application timing and readiness scoring. The agronomic decision is made by a deterministic engine, never by a language model.",
    version="0.1.0",
    lifespan=lifespan,
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://localhost:{settings.web_port}",
        f"http://127.0.0.1:{settings.web_port}",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)
app.include_router(router)
app.mount("/uploads", StaticFiles(directory=str(settings.uploads_dir)), name="uploads")

"""Database engine and session helpers."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from agrisense.config import REPO_ROOT, get_settings

from . import tables

_settings = get_settings()
_db_path = REPO_ROOT / "agrisense.db"
_engine = create_engine(f"sqlite:///{_db_path}", connect_args={"check_same_thread": False})


def get_engine():
    return _engine


def init_db() -> None:
    Path(_db_path).parent.mkdir(parents=True, exist_ok=True)
    SQLModel.metadata.create_all(_engine)


def get_session() -> Iterator[Session]:
    with Session(_engine) as session:
        yield session

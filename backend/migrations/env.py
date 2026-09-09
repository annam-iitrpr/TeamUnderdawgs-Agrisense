"""Alembic environment. The URL comes from configuration, never from a committed literal."""
from __future__ import annotations

from agrisense.config import get_settings
from agrisense.platform.db import Base, make_engine
from alembic import context

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    settings = get_settings()
    context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True,
                      dialect_opts={'paramstyle': 'named'}, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = make_engine(get_settings())
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations_offline() if context.is_offline_mode() else run_migrations_online()

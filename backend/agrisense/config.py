"""Settings loaded from .env. Every key is optional and nothing here can crash."""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class DataMode(StrEnum):
    MOCK = "mock"
    LIVE = "live"
    AUTO = "auto"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", REPO_ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    agrisense_data_mode: DataMode = DataMode.AUTO

    meteoblue_api_key: str = ""
    meteoblue_base_url: str = "https://my.meteoblue.com"

    cehub_base_url: str = "https://services.cehub.syngenta-ais.com"
    cehub_api_key: str = ""
    cehub_api_key_header: str = "ApiKey"
    cehub_bearer_token: str = ""
    cehub_basic_user: str = ""
    cehub_basic_pass: str = ""

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    database_url: str = "sqlite:///./agrisense.db"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    web_port: int = 3000

    @property
    def cehub_available(self) -> bool:
        return bool(self.cehub_api_key or self.cehub_bearer_token or self.cehub_basic_user)

    @property
    def meteoblue_available(self) -> bool:
        return bool(self.meteoblue_api_key)

    @property
    def gemini_available(self) -> bool:
        return bool(self.gemini_api_key)

    def should_try_live(self, source_available: bool) -> bool:
        """Whether to attempt a network call for a source with the given key state."""
        if self.agrisense_data_mode is DataMode.MOCK:
            return False
        if self.agrisense_data_mode is DataMode.LIVE:
            return True
        return source_available

    @property
    def cache_dir(self) -> Path:
        path = REPO_ROOT / "backend" / ".cache"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def uploads_dir(self) -> Path:
        path = REPO_ROOT / "uploads"
        path.mkdir(parents=True, exist_ok=True)
        return path


@lru_cache
def get_settings() -> Settings:
    return Settings()

"""Explicit local env loading; deployed services use injected configuration/ADC."""
from __future__ import annotations

import os
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]

class DataMode(StrEnum):
    MOCK = 'mock'
    LIVE = 'live'
    AUTO = 'auto'

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=os.environ.get('AGRISENSE_ENV_FILE',str(REPO_ROOT/'.env')),env_file_encoding='utf-8',extra='ignore',hide_input_in_errors=True)
    app_env: Literal['development','test','staging','production'] = 'development'
    agrisense_data_mode: DataMode = DataMode.AUTO
    database_url: str = 'sqlite://'
    firebase_project_id: str = 'demo-agrisense'
    firebase_auth_emulator_host: str = ''
    enable_dev_harness: bool = False
    allow_demo_data: bool = False
    cors_allowed_origins: str = 'http://localhost:3000,http://127.0.0.1:3000'
    public_api_base_url: str = 'http://localhost:8000'
    public_web_base_url: str = 'http://localhost:3000'
    api_host: str = '127.0.0.1'
    api_port: int = 8000
    web_port: int = 3000
    db_pool_size: int = 5
    db_max_overflow: int = 5
    max_request_bytes: int = 1048576
    local_media_dir: str = '.local/media'
    job_backend: Literal['local','cloud_tasks'] = 'local'
    meta_app_secret: str = ''
    whatsapp_webhook_verify_token: str = ''
    whatsapp_access_token: str = ''
    whatsapp_phone_number_id: str = ''
    whatsapp_business_account_id: str = ''
    whatsapp_graph_api_version: str = ''
    whatsapp_send_mode: Literal['outbox','live'] = 'outbox'
    gemini_backend: Literal['developer','vertex'] = 'developer'
    gemini_api_key: str = ''
    gemini_model: str = ''
    google_cloud_project: str = ''
    google_cloud_location: str = ''
    gcs_media_bucket: str = ''
    cloud_tasks_location: str = ''
    cloud_tasks_queue: str = 'agrisense-jobs'
    cloud_tasks_service_account_email: str = ''
    cloud_tasks_oidc_audience: str = ''
    worker_base_url: str = ''
    scheduler_service_account_email: str = ''
    scheduler_oidc_audience: str = ''
    meteoblue_api_key: str = ''
    meteoblue_base_url: str = 'https://my.meteoblue.com'
    cehub_base_url: str = 'https://services.cehub.syngenta-ais.com'
    cehub_api_key: str = ''
    cehub_api_key_header: str = 'ApiKey'
    cehub_bearer_token: str = ''
    cehub_basic_user: str = ''
    cehub_basic_pass: str = ''

    @model_validator(mode='after')
    def deployment_guards(self) -> Settings:
        emulator=self.firebase_auth_emulator_host or os.environ.get('FIREBASE_AUTH_EMULATOR_HOST','')
        if self.app_env in ('staging','production'):
            if emulator or self.enable_dev_harness or self.allow_demo_data or self.agrisense_data_mode==DataMode.MOCK:
                raise ValueError('Emulators, dev harness and demo data are forbidden in deployed services')
            if not self.database_url.startswith('postgresql'):
                raise ValueError('Deployed services require PostgreSQL')
            if self.firebase_project_id.startswith('demo-'):
                raise ValueError('Deployed services require a real Firebase project')
        if emulator and self.app_env not in ('development','test'):
            raise ValueError('Firebase emulator is local only')
        return self

    @property
    def cehub_available(self) -> bool:
        return bool(self.cehub_api_key or self.cehub_bearer_token or self.cehub_basic_user)
    @property
    def meteoblue_available(self) -> bool:
        return bool(self.meteoblue_api_key)
    @property
    def gemini_available(self) -> bool:
        return bool(self.gemini_model and (self.gemini_api_key or self.gemini_backend=='vertex'))
    def should_try_live(self, source_available: bool) -> bool:
        return self.agrisense_data_mode != DataMode.MOCK and (self.agrisense_data_mode==DataMode.LIVE or source_available)
    @property
    def cache_dir(self) -> Path:
        path=REPO_ROOT/'.local/cache';path.mkdir(parents=True,exist_ok=True);return path
    @property
    def uploads_dir(self) -> Path:
        path=REPO_ROOT/self.local_media_dir;path.mkdir(parents=True,exist_ok=True);return path

@lru_cache
def get_settings() -> Settings:
    return Settings()

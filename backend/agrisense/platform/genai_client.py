"""Shared Gemini client.

Built once per configuration and kept. Creating one inline for a call lets it be collected
the moment the expression moves on to `.models`, which closes the underlying transport
mid-request and surfaces as "the client has been closed". That failure only appears under a
real workload, so the cache is the fix rather than an optimisation.
"""
from __future__ import annotations

import logging
import threading

from agrisense.config import Settings
from agrisense.platform.errors import unavailable

log = logging.getLogger('agrisense.platform.genai')
_lock = threading.Lock()
_clients: dict[tuple[str, str, str], object] = {}


def get(settings: Settings):
    if not settings.gemini_available:
        raise unavailable('Google AI model')
    key = (settings.gemini_backend, settings.gemini_api_key, settings.google_cloud_project)
    with _lock:
        existing = _clients.get(key)
        if existing is not None:
            return existing
        try:
            from google import genai
        except ImportError as exc:
            raise unavailable('Google AI model') from exc
        if settings.gemini_backend == 'vertex':
            client = genai.Client(vertexai=True, project=settings.google_cloud_project,
                                  location=settings.google_cloud_location or 'asia-south1')
        else:
            client = genai.Client(api_key=settings.gemini_api_key)
        _clients[key] = client
        return client

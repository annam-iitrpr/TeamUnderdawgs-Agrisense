"""Deployment entry point. Only the authenticated contract_v1 surface is served.

The pre-contract router in `agrisense/api/` served unauthenticated reads and a public
`/uploads` mount; it is deliberately no longer mounted and must not be re-enabled.
"""
from __future__ import annotations

import logging

from agrisense.config import get_settings
from agrisense.platform.app import create_app

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')

app = create_app(get_settings())

"""Analytics export.

Domain events reach the warehouse through the same outbox every other consumer uses, so a
failed export retries and dead-letters on its own receipt without affecting anything else.

Rows carry identifiers and counts, never free text a farmer typed and never a phone number,
because a warehouse is copied, joined and shared far more widely than the operational store.
"""
from __future__ import annotations

import logging
from typing import Any

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform.errors import unavailable

log = logging.getLogger('agrisense.platform.analytics')
CONSUMER = 'analytics'
# Only these leave the operational store. Anything else is dropped rather than exported blindly.
EXPORTED_FIELDS = ('event_id', 'event_type', 'aggregate_id', 'aggregate_version', 'tenant_id',
                   'occurred_at', 'payload_reference_id', 'schema_version')


def row_for(event: d.OutboxRow) -> dict[str, Any] | None:
    """Shape one outbox row for the warehouse, or decline to export it."""
    payload = event.payload or {}
    if 'event_type' not in payload:
        # Operational messages such as queued jobs and outbound sends are not analytics events.
        return None
    domain = c.DomainEvent.model_validate(payload)
    exported = domain.model_dump(mode='json')
    return {key: exported[key] for key in EXPORTED_FIELDS if key in exported}


def client(settings: Settings):
    if not settings.analytics_available:
        raise unavailable('Analytics export')
    try:
        from google.cloud import bigquery
    except ImportError as exc:
        raise unavailable('Analytics export') from exc
    return bigquery.Client(project=settings.google_cloud_project or settings.firebase_project_id)


def exporter(settings: Settings):
    """Build the outbox handler. Raising here keeps a misconfigured export from silently doing nothing."""
    warehouse = client(settings)
    table = f'{warehouse.project}.{settings.analytics_dataset}.{settings.analytics_table}'

    def handle(event: d.OutboxRow) -> None:
        row = row_for(event)
        if row is None:
            return
        # insert_id makes an at-least-once redelivery a no-op on the warehouse side.
        errors = warehouse.insert_rows_json(table, [row], row_ids=[row['event_id']])
        if errors:
            raise RuntimeError(f'analytics insert rejected {len(errors)} row(s)')

    return handle


def drain(sessions, settings: Settings, limit: int = 500) -> int:
    from agrisense.platform.worker import drain_outbox
    return drain_outbox(sessions, CONSUMER, exporter(settings), limit=limit)

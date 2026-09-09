"""What leaves for the warehouse: identifiers and counts, never what a farmer typed."""
from __future__ import annotations

import json

import pytest
from agrisense.config import Settings
from agrisense.platform import analytics, worker
from agrisense.platform import db as d
from agrisense.platform.errors import PlatformError
from sqlalchemy import select


def test_without_a_dataset_the_export_reports_its_dependency(harness):
    with pytest.raises(PlatformError) as raised:
        analytics.client(harness.app.state.settings)
    assert raised.value.code == 'DEPENDENCY_UNAVAILABLE'
    assert Settings(app_env='test', analytics_dataset='').analytics_available is False


def test_only_domain_events_are_exported_and_operational_messages_are_declined(harness, asha, season):
    with harness.app.state.sessions() as session:
        rows = list(session.scalars(select(d.OutboxRow)))
        assert rows
        shaped = [(row.kind, analytics.row_for(row)) for row in rows]
    domain = [row for kind, row in shaped if row is not None]
    declined = [kind for kind, row in shaped if row is None]
    assert domain, 'no domain event was exportable'
    assert all(set(row) <= set(analytics.EXPORTED_FIELDS) for row in domain)
    assert all(row['event_type'] in ('field.updated', 'season.updated') for row in domain)
    # A queued job is not an analytics event.
    assert 'job.requested' in declined or not declined


def test_free_text_and_identities_never_reach_the_warehouse(harness, asha, season):
    secret = 'my neighbour owes me money'
    asha.post(f'/seasons/{season["id"]}/journal',
              {'action': 'observation', 'occurred_at': '2026-09-09T04:00:00Z', 'text': secret})
    with harness.app.state.sessions() as session:
        exported = [analytics.row_for(row) for row in session.scalars(select(d.OutboxRow))]
    serialized = json.dumps([row for row in exported if row])
    assert secret not in serialized
    assert 'text' not in serialized and 'display_name' not in serialized


def test_a_failing_warehouse_retries_on_its_own_receipt_without_affecting_other_consumers(harness, season):
    sessions = harness.app.state.sessions
    attempts = []

    def refuse(event):
        attempts.append(event.id)
        raise RuntimeError('warehouse unavailable')

    assert worker.drain_outbox(sessions, analytics.CONSUMER, refuse) == 0
    assert attempts
    delivered = []
    # A different consumer is unaffected by the analytics failure.
    assert worker.drain_outbox(sessions, 'search-index', delivered.append) == len(attempts)
    with sessions() as session:
        states = {(r.consumer, r.status) for r in session.scalars(select(d.ConsumerReceipt))}
    assert (analytics.CONSUMER, 'pending') in states
    assert ('search-index', 'processed') in states

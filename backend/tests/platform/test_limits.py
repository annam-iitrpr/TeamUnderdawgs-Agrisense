"""Throttling: an attempt costs budget whether or not it succeeds, and reads never starve."""
from __future__ import annotations

import pytest
from agrisense.platform import db as d
from agrisense.platform import limits
from agrisense.platform.errors import PlatformError
from sqlalchemy import select


def test_expensive_work_is_metered_apart_from_ordinary_reads():
    assert limits.budget_for('GET', '/fields') is limits.READS
    assert limits.budget_for('POST', '/fields') is limits.WRITES
    assert limits.budget_for('POST', '/seasons/{id}/evaluate') is limits.EXPENSIVE
    assert limits.EXPENSIVE.limit < limits.WRITES.limit < limits.READS.limit


def test_a_subject_is_refused_once_its_budget_is_spent_and_recovers_next_window(harness):
    sessions = harness.app.state.sessions
    budget = limits.Budget('test', 3, 60)
    with sessions() as session:
        for _ in range(budget.limit):
            limits.check(session, 'user-a', budget, now=1000.0)
        with pytest.raises(PlatformError) as raised:
            limits.check(session, 'user-a', budget, now=1000.0)
        assert raised.value.status == 429
        assert raised.value.details['retry_after_seconds'] > 0
        # A different subject is unaffected.
        limits.check(session, 'user-b', budget, now=1000.0)
        # The next window starts clean.
        limits.check(session, 'user-a', budget, now=1060.0)
        session.commit()


def test_exhausting_one_budget_leaves_the_others_usable(harness):
    sessions = harness.app.state.sessions
    with sessions() as session:
        for _ in range(limits.EXPENSIVE.limit):
            limits.check(session, 'user-c', limits.EXPENSIVE, now=2000.0)
        with pytest.raises(PlatformError):
            limits.check(session, 'user-c', limits.EXPENSIVE, now=2000.0)
        # A farmer who has used up their evaluations can still read their own records.
        limits.check(session, 'user-c', limits.READS, now=2000.0)
        session.commit()


def test_a_failed_request_still_costs_budget(harness, asha):
    """Otherwise a caller sending nothing but invalid requests would never be throttled."""
    sessions = harness.app.state.sessions
    asha.get('/fields')
    assert asha.get('/fields/does-not-exist').status_code == 404
    with sessions() as session:
        rows = session.scalars(select(d.RateLimitWindow).where(d.RateLimitWindow.bucket == 'read')).all()
        assert rows and sum(row.count for row in rows) >= 2, 'the 404 was not counted'


def test_the_response_tells_a_client_how_long_to_wait(harness, asha, monkeypatch):
    monkeypatch.setattr(limits, 'READS', limits.Budget('read', 1, 60))
    monkeypatch.setattr(limits, 'budget_for', lambda method, path: limits.READS)
    assert asha.get('/fields').status_code == 200
    refused = asha.get('/fields')
    assert refused.status_code == 429
    assert refused.json()['error']['code'] == 'RATE_LIMITED'
    assert refused.json()['error']['retryable'] is True
    assert int(refused.headers['Retry-After']) > 0


def test_an_unauthenticated_flood_is_stopped_before_it_costs_a_token_verification(harness):
    guard = limits.AnonymousGuard(limit=3, window_seconds=60)
    assert all(guard.allow('10.0.0.1', now=500.0) for _ in range(3))
    assert guard.allow('10.0.0.1', now=500.0) is False
    # Another client is unaffected, and the next window is clean.
    assert guard.allow('10.0.0.2', now=500.0) is True
    assert guard.allow('10.0.0.1', now=560.0) is True


def test_the_guard_does_not_grow_without_bound(harness):
    guard = limits.AnonymousGuard(limit=1, window_seconds=60)
    for index in range(10100):
        guard.allow(f'10.1.{index // 256}.{index % 256}', now=700.0)
    assert len(guard.seen) <= 10100


def test_old_windows_are_pruned_by_the_worker(harness):
    sessions = harness.app.state.sessions
    budget = limits.Budget('test', 5, 60)
    with sessions() as session:
        limits.check(session, 'user-old', budget, now=1000.0)
        limits.check(session, 'user-new', budget, now=100000.0)
        session.commit()
        assert limits.prune(session, now=100000.0, keep_seconds=3600) == 1
        session.commit()
        remaining = session.scalars(select(d.RateLimitWindow).where(
            d.RateLimitWindow.bucket == 'test')).all()
        assert [row.subject for row in remaining] == ['user-new']

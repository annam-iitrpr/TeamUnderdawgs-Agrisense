"""Durability of queued work: leasing, retry, dead lettering and exactly-once delivery."""
from __future__ import annotations

from datetime import timedelta

from agrisense.platform import db as d
from agrisense.platform import worker
from sqlalchemy import select


def queued(harness, season_id):
    caller_headers = {'Authorization': 'Bearer token-asha', 'Idempotency-Key': 'evaluate-key-1'}
    return harness.post(f'/api/v1/seasons/{season_id}/evaluate', json={'expected_version': 1}, headers=caller_headers)


def test_evaluation_is_queued_as_a_job_and_reported_through_the_jobs_route(harness, asha, season):
    response = queued(harness, season['id'])
    assert response.status_code == 202, response.text
    job = response.json()['data']
    assert job['kind'] == 'science.evaluate' and job['status'] == 'pending'
    assert asha.get(f'/jobs/{job["id"]}').json()['data']['status'] == 'pending'
    with harness.app.state.sessions() as session:
        assert session.scalar(select(d.OutboxRow).where(d.OutboxRow.kind == 'job.requested')) is not None


async def test_absent_science_dead_letters_after_bounded_retries_without_losing_the_job(harness, asha, season):
    job_id = queued(harness, season['id']).json()['data']['id']
    sessions = harness.app.state.sessions
    for attempt in range(1, worker.MAX_ATTEMPTS + 1):
        with sessions() as session:
            row = session.get(d.JobRow, job_id)
            row.run_after = d.utcnow() - timedelta(seconds=1)
            session.commit()
        assert await worker.drain_jobs(sessions) == 1
        with sessions() as session:
            row = session.get(d.JobRow, job_id)
            assert row.attempts == attempt
            assert row.payload['error']['code'] == 'DEPENDENCY_UNAVAILABLE'
            expected = 'dead_letter' if attempt == worker.MAX_ATTEMPTS else 'pending'
            assert row.status == expected
    # A dead letter stays visible to its owner rather than disappearing.
    assert asha.get(f'/jobs/{job_id}').json()['data']['status'] == 'dead_letter'


async def test_a_claimed_job_is_not_handed_to_a_second_worker(harness, season):
    queued(harness, season['id'])
    sessions = harness.app.state.sessions
    with sessions() as first:
        claimed = worker.claim_job(first, 'worker-one')
        assert claimed is not None
        first.commit()
        with sessions() as second:
            assert worker.claim_job(second, 'worker-two') is None
            second.rollback()


async def test_an_expired_lease_returns_the_job_to_the_queue(harness, season):
    queued(harness, season['id'])
    sessions = harness.app.state.sessions
    with sessions() as session:
        row = worker.claim_job(session, 'crashed-worker')
        identifier = row.id
        session.commit()
    with sessions() as session:
        session.get(d.JobRow, identifier).lease_until = d.utcnow() - timedelta(seconds=1)
        session.commit()
    with sessions() as session:
        recovered = worker.claim_job(session, 'healthy-worker')
        assert recovered is not None and recovered.id == identifier
        assert recovered.lease_token == 'healthy-worker'
        session.rollback()


def test_outbox_delivers_once_per_consumer_and_survives_a_replay(harness, season):
    sessions = harness.app.state.sessions
    seen = []
    assert worker.drain_outbox(sessions, 'analytics', seen.append) > 0
    first = len(seen)
    assert worker.drain_outbox(sessions, 'analytics', seen.append) == 0
    assert len(seen) == first
    with sessions() as session:
        receipts = session.scalars(select(d.ConsumerReceipt)).all()
        assert len(receipts) == first
        assert {receipt.consumer for receipt in receipts} == {'analytics'}
        assert all(receipt.status == 'processed' for receipt in receipts)
    # A second consumer receives the same events independently.
    other = []
    assert worker.drain_outbox(sessions, 'search-index', other.append) == first


def test_a_failing_consumer_backs_off_and_eventually_dead_letters(harness, season):
    sessions = harness.app.state.sessions

    def explode(_row):
        raise RuntimeError('downstream is down')

    for _ in range(worker.MAX_ATTEMPTS):
        with sessions() as session:
            for receipt in session.scalars(select(d.ConsumerReceipt)):
                receipt.available_at = d.utcnow() - timedelta(seconds=1)
            session.commit()
        assert worker.drain_outbox(sessions, 'flaky', explode) == 0
    with sessions() as session:
        receipts = session.scalars(select(d.ConsumerReceipt).where(d.ConsumerReceipt.consumer == 'flaky')).all()
        assert receipts and all(receipt.status == 'dead_letter' for receipt in receipts)
    # The failing consumer never blocks a healthy one.
    healthy = []
    assert worker.drain_outbox(sessions, 'analytics', healthy.append) == len(receipts)


def test_backoff_grows_and_is_capped():
    delays = [worker.backoff(attempt).total_seconds() for attempt in range(1, 9)]
    assert delays == sorted(delays)
    assert delays[0] == worker.BACKOFF_SECONDS and delays[-1] <= 3600


def test_a_task_whose_window_has_passed_expires_rather_than_staying_pending(harness, season):
    from agrisense.contracts_generated import models as c
    from agrisense.platform import science
    sessions = harness.app.state.sessions
    with sessions() as session:
        row = session.scalar(select(d.SeasonRow))
        due = c.Interval(start_at=d.utcnow() - timedelta(days=2), end_at=d.utcnow() - timedelta(days=1))
        spec = c.TaskSpec(season_id=row.id, due=due, priority='normal', title='Irrigate',
                          reason=c.Reason(code='SYNTHETIC_TEST_TASK'), deduplication_key='irrigate-1')
        science.persist_task(session, row.tenant_id, session.scalar(select(d.FarmerRow)).id, spec)
        session.commit()
        # The same key never produces a second task.
        assert science.persist_task(session, row.tenant_id, session.scalar(select(d.FarmerRow)).id, spec) is None
        assert science.expire_stale_tasks(session) == 1
        session.commit()
        assert session.scalar(select(d.TaskRow)).status == 'expired'

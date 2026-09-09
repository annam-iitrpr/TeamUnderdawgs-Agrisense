"""Reminder delivery: once, at a humane hour, and never for work already settled."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform import reminders
from sqlalchemy import select

IST = c.QuietHours()


def at(hour, minute=0, day=9):
    """A UTC instant; IST is UTC+5:30, so 16:00Z is 21:30 IST."""
    return datetime(2026, 9, day, hour, minute, tzinfo=UTC)


def daytime_soon():
    """The next 06:00 UTC (11:30 IST) after now: due in the future, and outside quiet hours."""
    now = d.utcnow()
    candidate = now.replace(hour=6, minute=0, second=0, microsecond=0)
    return candidate if candidate > now else candidate + timedelta(days=1)


def schedule(caller, season_id, when, channel='in_app'):
    return caller.post('/reminders', {'season_id': season_id, 'scheduled_at': when.isoformat(),
                                      'channel': channel, 'opted_in': True})


def test_quiet_hours_defer_to_the_moment_they_end_in_the_farmers_timezone():
    # 21:30 IST is inside the default 21:00-07:00 window; release is 07:00 IST next morning.
    deferred = reminders.next_allowed(at(16, 0), IST)
    assert deferred.astimezone(UTC) == at(1, 30, day=10)
    # 10:00 IST is outside the window and is not moved.
    assert reminders.next_allowed(at(4, 30), IST) == at(4, 30)
    # 02:00 IST is inside; release is 07:00 IST the same morning.
    assert reminders.next_allowed(at(20, 30, day=8), IST).astimezone(UTC) == at(1, 30)


def test_a_due_reminder_becomes_exactly_one_notification(harness, asha, season):
    when = daytime_soon()
    assert schedule(asha, season['id'], when).status_code == 201
    sessions = harness.app.state.sessions
    settings = harness.app.state.settings

    # Nothing is delivered before it is due.
    assert reminders.dispatch(sessions, settings, when - timedelta(minutes=10)) == {}
    assert asha.get('/notifications').json()['data']['items'] == []

    daytime = when + timedelta(minutes=1)
    assert reminders.dispatch(sessions, settings, daytime) == {'sent': 1}
    items = asha.get('/notifications').json()['data']['items']
    assert len(items) == 1 and items[0]['delivery_state'] == 'sent'

    # A second pass delivers nothing more.
    assert reminders.dispatch(sessions, settings, daytime + timedelta(minutes=1)) == {}
    assert len(asha.get('/notifications').json()['data']['items']) == 1


def test_a_reminder_for_settled_work_is_cancelled_rather_than_delivered(harness, asha, season):
    from agrisense.platform import science
    sessions = harness.app.state.sessions
    with sessions() as session:
        row = session.scalar(select(d.SeasonRow))
        farmer = session.scalar(select(d.FarmerRow))
        due_window = c.Interval(start_at=d.utcnow(), end_at=d.utcnow() + timedelta(days=1))
        spec = c.TaskSpec(season_id=row.id, due=due_window, priority='normal', title='Irrigate',
                          reason=c.Reason(code='SYNTHETIC_TEST_TASK'), deduplication_key='irrigate-settled')
        task = science.persist_task(session, row.tenant_id, farmer.id, spec)
        task_id = task.id
        session.commit()

    when = daytime_soon()
    created = asha.post('/reminders', {'season_id': season['id'], 'scheduled_at': when.isoformat(),
                                       'channel': 'in_app', 'opted_in': True, 'task_id': task_id})
    assert created.status_code == 201, created.text
    version = asha.get('/tasks').json()['data']['items'][0]['version']
    assert asha.patch(f'/tasks/{task_id}', {'expected_version': version, 'status': 'done'}).status_code == 200

    assert reminders.dispatch(harness.app.state.sessions, harness.app.state.settings,
                              when + timedelta(minutes=1)) == {'task_settled': 1}
    assert asha.get('/notifications').json()['data']['items'] == []


def test_a_reminder_missed_by_hours_is_dropped_instead_of_waking_someone_late(harness, asha, season):
    when = d.utcnow() + timedelta(minutes=5)
    schedule(asha, season['id'], when)
    late = when + reminders.CATCH_UP + timedelta(hours=1)
    assert reminders.dispatch(harness.app.state.sessions, harness.app.state.settings, late) == {'too_late': 1}
    assert asha.get('/notifications').json()['data']['items'] == []


def test_an_opted_out_channel_never_produces_an_outbound_message(harness, asha, season):
    when = daytime_soon()
    assert schedule(asha, season['id'], when, 'whatsapp').status_code == 201
    outcomes = reminders.dispatch(harness.app.state.sessions, harness.app.state.settings,
                                  when + timedelta(minutes=1))
    assert outcomes == {'failed': 1}
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.OutboxRow).where(d.OutboxRow.kind == 'whatsapp.outbound')).all() == []
    assert asha.get('/notifications').json()['data']['items'][0]['delivery_state'] == 'failed'


def test_cancelling_a_reminder_stops_delivery(harness, asha, season):
    when = daytime_soon()
    reminder = schedule(asha, season['id'], when).json()['data']
    assert asha.delete(f'/reminders/{reminder["id"]}', params={'expected_version': 1}).status_code == 200
    assert reminders.dispatch(harness.app.state.sessions, harness.app.state.settings,
                              when + timedelta(minutes=1)) == {}
    assert asha.get('/notifications').json()['data']['items'] == []

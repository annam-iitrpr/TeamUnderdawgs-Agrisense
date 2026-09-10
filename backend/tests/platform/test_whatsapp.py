"""Inbound WhatsApp is a public URL: nothing is trusted before the signature check."""
from __future__ import annotations

import hashlib
import hmac
import json

from agrisense.platform import db as d
from agrisense.platform import whatsapp
from sqlalchemy import select

SECRET = 'test-meta-app-secret'
VERIFY = 'test-verify-token'
NUMBER = '919999900001'


def signed(harness, payload, secret=SECRET):
    raw = json.dumps(payload).encode()
    digest = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return harness.post('/webhooks/whatsapp', content=raw,
                        headers={'X-Hub-Signature-256': f'sha256={digest}', 'Content-Type': 'application/json'})


def message(text='hello', message_id='wamid.1', sender=NUMBER):
    return {'entry': [{'changes': [{'value': {'messages': [
        {'id': message_id, 'from': sender, 'type': 'text', 'text': {'body': text}, 'timestamp': '1757462400'}]}}]}]}


def test_an_unsigned_or_forged_delivery_is_refused(harness):
    raw = json.dumps(message()).encode()
    assert harness.post('/webhooks/whatsapp', content=raw).status_code == 403
    forged = hmac.new(b'wrong-secret', raw, hashlib.sha256).hexdigest()
    assert harness.post('/webhooks/whatsapp', content=raw,
                        headers={'X-Hub-Signature-256': f'sha256={forged}'}).status_code == 403
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.WebhookInbox)).all() == []


def test_without_an_app_secret_no_delivery_is_accepted(harness_without_messaging_secret):
    harness = harness_without_messaging_secret
    response = harness.post('/webhooks/whatsapp', content=json.dumps(message()).encode(),
                            headers={'X-Hub-Signature-256': 'sha256=' + 'a' * 64})
    assert response.status_code == 503
    assert response.json()['error']['code'] == 'WEBHOOK_NOT_CONFIGURED'


def test_subscription_verification_echoes_only_for_the_configured_token(harness):
    ok = harness.get('/webhooks/whatsapp', params={'hub.mode': 'subscribe', 'hub.verify_token': VERIFY,
                                                   'hub.challenge': 'nonce-123'})
    assert ok.status_code == 200 and ok.text == 'nonce-123'
    bad = harness.get('/webhooks/whatsapp', params={'hub.mode': 'subscribe', 'hub.verify_token': 'guess',
                                                    'hub.challenge': 'nonce-123'})
    assert bad.status_code == 403


def test_a_retried_delivery_is_recorded_once(harness):
    assert signed(harness, message()).status_code == 200
    assert signed(harness, message()).status_code == 200
    with harness.app.state.sessions() as session:
        rows = session.scalars(select(d.WebhookInbox)).all()
        assert len(rows) == 1
        # The raw phone number is never stored.
        assert NUMBER not in json.dumps(rows[0].payload)
        assert rows[0].payload['from_hash'] == whatsapp.identity_hash(NUMBER)


def test_an_unlinked_sender_is_never_guessed_into_an_account(harness, asha):
    asha.get('/me')
    assert signed(harness, message()).status_code == 200
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.JobRow)).all() == []
        assert session.scalars(select(d.ChannelRow)).all() == []


def test_a_link_code_binds_one_identity_once_and_then_messages_are_queued(harness, asha):
    challenge = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'})
    assert challenge.status_code == 201, challenge.text
    code = challenge.json()['data']['code']

    assert signed(harness, message(f'LINK {code}', 'wamid.link')).status_code == 200
    with harness.app.state.sessions() as session:
        channel = session.scalar(select(d.ChannelRow).where(d.ChannelRow.provider == 'whatsapp'))
        assert channel is not None and channel.opted_in
        assert channel.external_id_hash == whatsapp.identity_hash(NUMBER)
        assert channel.payload['msisdn'] == NUMBER

    # The same code cannot bind a second identity.
    assert signed(harness, message(f'LINK {code}', 'wamid.link2', '919999900002')).status_code == 200
    with harness.app.state.sessions() as session:
        assert len(session.scalars(select(d.ChannelRow).where(d.ChannelRow.provider == 'whatsapp')).all()) == 1

    assert signed(harness, message('I watered the field', 'wamid.2')).status_code == 200
    with harness.app.state.sessions() as session:
        jobs = session.scalars(select(d.JobRow).where(d.JobRow.kind == 'whatsapp.inbound')).all()
        assert len(jobs) == 1


def test_a_linked_text_creates_the_normal_conversation_and_assistant_job(harness, asha):
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    assert signed(harness, message('Show my pending tasks', 'wamid.question')).status_code == 200
    with harness.app.state.sessions() as session:
        conversation = session.scalar(select(d.ConversationRow))
        assert conversation is not None
        user_message = session.scalar(select(d.MessageRow).where(d.MessageRow.payload['text'].as_string() == 'Show my pending tasks'))
        assert user_message is not None
        job = session.scalar(select(d.JobRow).where(d.JobRow.kind == 'whatsapp.inbound'))
        assert job is not None
        assert job.payload['request']['message_id'] == user_message.id


def test_media_is_recorded_but_does_not_create_an_empty_assistant_turn(harness, asha):
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    payload = {'entry': [{'changes': [{'value': {'messages': [
        {'id': 'wamid.photo', 'from': NUMBER, 'type': 'image',
         'image': {'id': 'media.1'}, 'timestamp': '1757462400'}]}}]}]}
    assert signed(harness, payload).status_code == 200
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.JobRow).where(d.JobRow.kind == 'whatsapp.inbound')).all() == []


def test_unlinking_stops_further_ingestion(harness, asha):
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    assert asha.delete('/channels/whatsapp/link').status_code == 200
    assert signed(harness, message('another note', 'wamid.3')).status_code == 200
    with harness.app.state.sessions() as session:
        assert session.scalars(select(d.JobRow).where(d.JobRow.kind == 'whatsapp.inbound')).all() == []


def test_outbound_outside_the_session_window_is_marked_as_needing_a_template(harness, asha):
    from datetime import timedelta
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    with harness.app.state.sessions() as session:
        channel = session.scalar(select(d.ChannelRow).where(d.ChannelRow.provider == 'whatsapp'))
        queued = whatsapp.queue_outbound(session, harness.app.state.settings, channel, 'Irrigation is due today.')
        assert queued.payload['requires_template'] is False
        # A reply more than a day after the last inbound message needs an approved template.
        channel.last_inbound_at = d.utcnow() - timedelta(days=2)
        later = whatsapp.queue_outbound(session, harness.app.state.settings, channel, 'Irrigation is due today.')
        assert later.payload['requires_template'] is True
        # Nothing is sent from a test run; delivery stays queued.
        assert later.payload['send_mode'] == 'outbox'
        session.commit()


def linked_channel(harness, asha):
    code = asha.post('/channels/whatsapp/link', {'consent_version': '2026-09-01'}).json()['data']['code']
    signed(harness, message(f'LINK {code}', 'wamid.link'))
    with harness.app.state.sessions() as session:
        return session.scalar(select(d.ChannelRow).where(d.ChannelRow.provider == 'whatsapp')).id


def test_nothing_is_sent_while_the_deployment_is_in_outbox_mode(harness, asha, monkeypatch):
    """Queueing is not sending. A misconfigured flip must not silently message farmers."""
    calls = []
    monkeypatch.setattr(whatsapp, 'send', lambda *args: calls.append(args) or 'wamid.out')
    channel_id = linked_channel(harness, asha)
    settings = harness.app.state.settings
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        event = whatsapp.queue_outbound(session, settings, channel, 'Irrigation is due today.')
        session.commit()
        assert whatsapp.deliver_outbound(session, settings, event) == 'queued_not_sent'
    assert calls == []


def test_a_message_outside_the_session_window_needs_a_template_and_is_not_sent(harness, asha, monkeypatch):
    from datetime import timedelta
    calls = []
    monkeypatch.setattr(whatsapp, 'send', lambda *args: calls.append(args) or 'wamid.out')
    channel_id = linked_channel(harness, asha)
    settings = harness.app.state.settings.model_copy(update={'whatsapp_send_mode': 'live'})
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        channel.last_inbound_at = d.utcnow() - timedelta(days=2)
        event = whatsapp.queue_outbound(session, settings, channel, 'Irrigation is due today.')
        session.commit()
        assert whatsapp.deliver_outbound(session, settings, event) == 'template_required'
    assert calls == []


def test_a_revoked_channel_is_not_messaged_even_if_something_was_already_queued(harness, asha, monkeypatch):
    calls = []
    monkeypatch.setattr(whatsapp, 'send', lambda *args: calls.append(args) or 'wamid.out')
    channel_id = linked_channel(harness, asha)
    settings = harness.app.state.settings.model_copy(update={'whatsapp_send_mode': 'live'})
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        event = whatsapp.queue_outbound(session, settings, channel, 'Irrigation is due today.')
        session.commit()
    assert asha.delete('/channels/whatsapp/link').status_code == 200
    with harness.app.state.sessions() as session:
        assert whatsapp.deliver_outbound(session, settings, event) == 'not_opted_in'
    assert calls == []


def test_a_send_never_happens_without_a_number_the_farmer_supplied(harness, asha, monkeypatch):
    calls = []
    monkeypatch.setattr(whatsapp, 'send', lambda *args: calls.append(args) or 'wamid.out')
    channel_id = linked_channel(harness, asha)
    settings = harness.app.state.settings.model_copy(update={'whatsapp_send_mode': 'live'})
    with harness.app.state.sessions() as session:
        channel = session.get(d.ChannelRow, channel_id)
        event = whatsapp.queue_outbound(session, settings, channel, 'Irrigation is due today.')
        session.commit()
        # Only a digest is stored, so there is no number to send to unless one was supplied.
        assert whatsapp.deliver_outbound(session, settings, event) == 'recipient_unknown'
    assert calls == []

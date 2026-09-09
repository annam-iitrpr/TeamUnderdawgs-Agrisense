"""WhatsApp Cloud API ingestion and outbound queueing.

Inbound payloads are only trusted after an HMAC signature check against the Meta app secret.
Without that secret configured the endpoint refuses every delivery rather than accepting
unsigned input, because a webhook is a public URL that anyone can post to.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from agrisense.config import Settings
from agrisense.platform import db as d
from agrisense.platform.errors import PlatformError

log = logging.getLogger('agrisense.platform.whatsapp')
LINK_PREFIX = 'LINK'
SESSION_WINDOW = timedelta(hours=24)


def identity_hash(external_id: str) -> str:
    """Phone numbers are stored only as digests, so the inbox never holds a raw number."""
    return hashlib.sha256(external_id.strip().encode()).hexdigest()


def verify_signature(settings: Settings, body: bytes, header: str) -> None:
    if not settings.meta_app_secret:
        raise PlatformError('WEBHOOK_NOT_CONFIGURED',
                            'Inbound messaging is not configured.', 503, True)
    algorithm, _, digest = header.partition('=')
    if algorithm != 'sha256' or not digest:
        raise PlatformError('WEBHOOK_SIGNATURE_INVALID', 'This delivery could not be verified.', 403)
    expected = hmac.new(settings.meta_app_secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, digest):
        raise PlatformError('WEBHOOK_SIGNATURE_INVALID', 'This delivery could not be verified.', 403)


def verify_subscription(settings: Settings, mode: str, token: str, challenge: str) -> str:
    if not settings.whatsapp_webhook_verify_token:
        raise PlatformError('WEBHOOK_NOT_CONFIGURED', 'Inbound messaging is not configured.', 503, True)
    if mode != 'subscribe' or not hmac.compare_digest(token, settings.whatsapp_webhook_verify_token):
        raise PlatformError('WEBHOOK_VERIFICATION_FAILED', 'This subscription could not be verified.', 403)
    return challenge


def extract(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Flatten the Cloud API envelope into the few fields the platform acts on."""
    events: list[dict[str, Any]] = []
    for entry in payload.get('entry', []) or []:
        for change in entry.get('changes', []) or []:
            value = change.get('value', {}) or {}
            for message in value.get('messages', []) or []:
                events.append({'kind': 'message', 'external_message_id': message.get('id', ''),
                               'from': message.get('from', ''), 'type': message.get('type', ''),
                               'text': (message.get('text') or {}).get('body', ''),
                               'media_id': ((message.get(message.get('type', '')) or {}) or {}).get('id'),
                               'timestamp': message.get('timestamp')})
            for status in value.get('statuses', []) or []:
                events.append({'kind': 'status', 'external_message_id': status.get('id', ''),
                               'status': status.get('status', ''), 'recipient': status.get('recipient_id', '')})
    return events


def record(session: Session, event: dict[str, Any]) -> bool:
    """Store each delivery once. A Meta retry of the same id is accepted and ignored."""
    if not event.get('external_message_id'):
        return False
    stored = {key: value for key, value in event.items() if key not in ('from', 'recipient')}
    if event.get('from'):
        stored['from_hash'] = identity_hash(event['from'])
    if event.get('recipient'):
        stored['recipient_hash'] = identity_hash(event['recipient'])
    row = d.WebhookInbox(provider='whatsapp', external_message_id=event['external_message_id'],
                         kind=event['kind'], payload=stored)
    try:
        with session.begin_nested():
            session.add(row)
            session.flush()
    except IntegrityError:
        return False
    return True


def resolve_channel(session: Session, digest: str) -> d.ChannelRow | None:
    return session.scalar(select(d.ChannelRow).where(
        d.ChannelRow.provider == 'whatsapp', d.ChannelRow.external_id_hash == digest))


def redeem_link(session: Session, digest: str, code: str) -> d.ChannelRow | None:
    """A code links one WhatsApp identity to the farmer who requested it, exactly once."""
    challenge = session.scalar(select(d.LinkChallenge).where(
        d.LinkChallenge.code_hash == hashlib.sha256(code.encode()).hexdigest(),
        d.LinkChallenge.used.is_(False)))
    if challenge is None or d.aware(challenge.expires_at) <= d.utcnow():
        return None
    if resolve_channel(session, digest) is not None:
        return None
    challenge.used = True
    row = d.ChannelRow(tenant_id=challenge.tenant_id, farmer_id=challenge.farmer_id,
                       provider='whatsapp', external_id_hash=digest, opted_in=True,
                       last_inbound_at=d.utcnow(), version=1,
                       payload={'id': d.new_id(), 'consent_version': challenge.payload.get('consent_version')})
    session.add(row)
    return row


def ingest(session: Session, event: dict[str, Any]) -> str:
    """Turn one verified inbound message into platform work, or explain why it was ignored."""
    if event['kind'] != 'message':
        return 'status'
    digest = identity_hash(event.get('from', ''))
    text = (event.get('text') or '').strip()
    if text.upper().startswith(LINK_PREFIX):
        code = text[len(LINK_PREFIX):].strip()
        return 'linked' if redeem_link(session, digest, code) else 'link_rejected'
    channel = resolve_channel(session, digest)
    if channel is None:
        # An unlinked sender is never guessed into an account.
        return 'unlinked'
    if not channel.opted_in:
        return 'opted_out'
    channel.last_inbound_at = d.utcnow()
    session.add(d.JobRow(tenant_id=channel.tenant_id, farmer_id=channel.farmer_id,
                         kind='whatsapp.inbound', status='pending', attempts=0,
                         payload={'id': d.new_id(), 'request': {'external_message_id': event['external_message_id']}}))
    return 'queued'


def graph_url(settings: Settings) -> str:
    version = settings.whatsapp_graph_api_version or 'v21.0'
    return f'https://graph.facebook.com/{version}/{settings.whatsapp_phone_number_id}/messages'


def send(settings: Settings, recipient: str, body: str) -> str:
    """Deliver one message. Only called when live mode is explicitly configured."""
    import httpx
    if not (settings.whatsapp_access_token and settings.whatsapp_phone_number_id):
        raise PlatformError('WHATSAPP_NOT_CONFIGURED', 'Outbound messaging is not configured.', 503, True)
    try:
        response = httpx.post(
            graph_url(settings),
            headers={'Authorization': f'Bearer {settings.whatsapp_access_token}'},
            json={'messaging_product': 'whatsapp', 'to': recipient, 'type': 'text',
                  'text': {'preview_url': False, 'body': body}},
            timeout=10.0)
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        # The provider's own error text can carry account details, so it is never re-raised verbatim.
        log.warning('whatsapp send failed: %s', type(exc).__name__)
        raise PlatformError('WHATSAPP_SEND_FAILED', 'The message could not be sent.', 503, True) from exc
    return (payload.get('messages') or [{}])[0].get('id', '')


def deliver_outbound(session: Session, settings: Settings, event: d.OutboxRow) -> str:
    """Outbox consumer for queued messages. Refuses to send what policy says it may not."""
    payload = event.payload or {}
    if payload.get('send_mode') != 'live' or settings.whatsapp_send_mode != 'live':
        return 'queued_not_sent'
    if payload.get('requires_template'):
        # Outside the 24 hour window only an approved template may be sent, and none is registered.
        return 'template_required'
    channel = session.get(d.ChannelRow, payload.get('channel_id'))
    if channel is None or not channel.opted_in:
        return 'not_opted_in'
    recipient = (channel.payload or {}).get('msisdn')
    if not recipient:
        # Only a digest is stored, so a send needs a number the farmer supplied for this purpose.
        return 'recipient_unknown'
    send(settings, recipient, str(payload.get('body', ''))[:4000])
    return 'sent'


def queue_outbound(session: Session, settings: Settings, channel: d.ChannelRow, body: str) -> d.OutboxRow:
    """Outbound messages are queued, and only sent when live mode is explicitly configured."""
    if not channel.opted_in:
        raise PlatformError('CHANNEL_NOT_OPTED_IN', 'This channel is not opted in.', 409)
    within_session = channel.last_inbound_at is not None and d.aware(channel.last_inbound_at) > d.utcnow() - SESSION_WINDOW
    row = d.OutboxRow(tenant_id=channel.tenant_id, kind='whatsapp.outbound', aggregate_id=channel.id,
                      payload={'channel_id': channel.id, 'body': body,
                               'requires_template': not within_session,
                               'send_mode': settings.whatsapp_send_mode})
    session.add(row)
    return row

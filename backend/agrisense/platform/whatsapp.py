"""WhatsApp Cloud API ingestion and outbound queueing.

Inbound payloads are only trusted after an HMAC signature check against the Meta app secret.
Without that secret configured the endpoint refuses every delivery rather than accepting
unsigned input, because a webhook is a public URL that anyone can post to.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform import media
from agrisense.platform.errors import PlatformError

log = logging.getLogger('agrisense.platform.whatsapp')
LINK_PREFIX = 'LINK'
SESSION_WINDOW = timedelta(hours=24)
MEDIA_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/webm'}
# Cloud API interactive limits. Exceeding any of them is rejected for the whole
# message, so every option is trimmed to fit rather than risking a silent failure.
BUTTON_LIMIT = 3
BUTTON_TITLE = 20
LIST_LIMIT = 10
LIST_TITLE = 24
LIST_DESCRIPTION = 72


@dataclass(frozen=True)
class ChannelReply:
    """An answer together with the ways out of it.

    A farmer on WhatsApp should never have to remember a command vocabulary or type a
    value in a shape we invented. Every reply therefore carries its next steps as
    tappable options: up to three as quick-reply buttons, more as a list. Free text
    still works, and still reaches the assistant, but nobody has to use it to navigate.
    """

    body: str
    buttons: tuple[tuple[str, str], ...] = ()
    #: Label on the control that opens a list. Only meaningful when `options` is set.
    list_label: str = 'Choose'
    options: tuple[tuple[str, str, str], ...] = ()


#: The whole navigable surface, as a list because it is longer than three buttons.
MENU_OPTIONS: tuple[tuple[str, str, str], ...] = (
    ('readiness', 'Readiness', 'Is the crop ready, and what to do next'),
    ('water', 'Water', 'How much water the crop needs now'),
    ('money', 'Money', 'Costs and sales recorded for this season'),
    ('history', 'Field log', 'The last few things recorded'),
    ('fields', 'Switch field', 'Choose which field to ask about'),
    ('journal_help', 'Record something', 'Log irrigation, spraying or harvest'),
    ('close', 'Close season', 'Record the harvest and finish the season'),
)
#: Appended to answers so a farmer is never left at a dead end with nothing to tap.
MENU_BUTTON = ('menu', 'Menu')


def menu_reply(body: str) -> ChannelReply:
    return ChannelReply(body=body, list_label='Open menu', options=MENU_OPTIONS)


def with_menu(body: str, *buttons: tuple[str, str]) -> ChannelReply:
    """An answer plus its follow-ups, always ending in a way back to the menu."""
    return ChannelReply(body=body, buttons=(*buttons, MENU_BUTTON)[:BUTTON_LIMIT])


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
                message_type = message.get('type', '')
                content = message.get(message_type) or {}
                interactive = message.get('interactive') or {}
                reply = interactive.get('button_reply') or interactive.get('list_reply') or {}
                events.append({'kind': 'message', 'external_message_id': message.get('id', ''),
                               'from': message.get('from', ''), 'type': message_type,
                               'text': (message.get('text') or {}).get('body', '') or reply.get('id', '') or reply.get('title', ''),
                               'caption': content.get('caption', ''),
                               'media_id': content.get('id'),
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


def redeem_link(session: Session, external_id: str, code: str) -> d.ChannelRow | None:
    """A code links one WhatsApp identity to the farmer who requested it, exactly once."""
    digest = identity_hash(external_id)
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
                       # The inbox stores only a digest. The linked channel needs the
                       # provider id to send a reply, and is tenant-owned and erasable
                       # with the channel unlink/delete operation.
                       payload={'id': d.new_id(), 'msisdn': external_id,
                                'consent_version': challenge.payload.get('consent_version')})
    session.add(row)
    session.flush()

    # The farmer's own record has to say the channel exists. `Farmer` carries
    # `linked_channel_ids` and nothing ever populated it, so a linked account
    # still reported an empty list — the account screen would have shown
    # "Connect WhatsApp" forever to somebody already connected, and the only way
    # to tell would have been to read the database.
    farmer = session.get(d.FarmerRow, challenge.farmer_id)
    if farmer is not None:
        payload = dict(farmer.payload or {})
        linked = [value for value in (payload.get('linked_channel_ids') or []) if value != row.id]
        farmer.version += 1
        payload['linked_channel_ids'] = [*linked, row.id]
        payload['version'] = farmer.version
        farmer.payload = payload
    return row


def ingest(session: Session, event: dict[str, Any]) -> str:
    """Turn one verified inbound message into platform work, or explain why it was ignored."""
    if event['kind'] != 'message':
        return 'status'
    external_id = (event.get('from') or '').strip()
    if not external_id:
        return 'invalid_sender'
    digest = identity_hash(external_id)
    text = (event.get('text') or event.get('caption') or '').strip()
    if text.upper().startswith(LINK_PREFIX):
        code = text[len(LINK_PREFIX):].strip()
        return 'linked' if redeem_link(session, external_id, code) else 'link_rejected'
    channel = resolve_channel(session, digest)
    if channel is None:
        # An unlinked sender is never guessed into an account.
        return 'unlinked'
    if not channel.opted_in:
        return 'opted_out'
    if event.get('type') not in ('text', 'interactive', 'image', 'audio'):
        # Media requires a separate Meta media download and an internal media asset
        # before the assistant can read it. Keep the signed event for audit, but do
        # not create an empty assistant turn.
        return 'unsupported_message'
    if not text and not event.get('media_id'):
        return 'empty_message'
    channel.last_inbound_at = d.utcnow()
    channel_payload = channel.payload or {}
    conversation_id = channel_payload.get('conversation_id')
    conversation = session.scalar(select(d.ConversationRow).where(
        d.ConversationRow.id == conversation_id,
        d.ConversationRow.tenant_id == channel.tenant_id,
        d.ConversationRow.farmer_id == channel.farmer_id)) if conversation_id else None
    if conversation is None:
        conversation_id = d.new_id()
        conversation = d.ConversationRow(
            id=conversation_id, tenant_id=channel.tenant_id, farmer_id=channel.farmer_id,
            version=1, payload={'id': conversation_id, 'language': 'en', 'source': 'whatsapp'})
        session.add(conversation)
        channel.payload = {**channel_payload, 'conversation_id': conversation_id}
    command = None
    lowered = text.lower()
    if lowered in {'menu', 'help', 'start'}:
        command = 'menu'
    elif lowered in {'fields', 'my fields', 'switch field'}:
        command = 'fields'
    elif lowered in {'readiness', 'status', 'water', 'money', 'economics', 'history', 'log', 'journal_help'}:
        command = {'status': 'readiness', 'economics': 'money', 'log': 'history'}.get(lowered, lowered)
    elif lowered.startswith('field:'):
        # A tapped list row carries the field id, so selection needs no name matching.
        selected = session.scalar(select(d.FieldRow).where(
            d.FieldRow.id == text.split(':', 1)[1].strip(),
            d.FieldRow.tenant_id == channel.tenant_id,
            d.FieldRow.farmer_id == channel.farmer_id,
            d.FieldRow.archived.is_(False)))
        if selected is None:
            command = 'fields'
        else:
            conversation.payload = {**conversation.payload, 'field_id': selected.id}
            channel.payload = {**channel.payload, 'active_field_id': selected.id}
            command = 'field_selected'
    elif lowered.startswith('log '):
        command = 'journal'
    elif lowered.startswith('proposal_confirm:'):
        command = 'proposal_confirm'
    elif lowered.startswith('proposal_cancel:'):
        command = 'proposal_cancel'
    elif lowered.startswith('remind '):
        command = 'reminder'
    elif lowered in {'close', 'close season'}:
        command = 'close_prompt'
    elif lowered.startswith('close '):
        command = 'close_execute'
    elif lowered.startswith('use '):
        requested = text[4:].strip().lower()
        fields = list(session.scalars(select(d.FieldRow).where(
            d.FieldRow.tenant_id == channel.tenant_id,
            d.FieldRow.farmer_id == channel.farmer_id,
            d.FieldRow.archived.is_(False)).order_by(d.FieldRow.name)))
        selected = next((field for field in fields if field.name.lower() == requested), None)
        if selected is None and requested.isdigit():
            index = int(requested) - 1
            selected = fields[index] if 0 <= index < len(fields) else None
        if selected is not None:
            conversation.payload = {**conversation.payload, 'field_id': selected.id}
            channel.payload = {**channel.payload, 'active_field_id': selected.id}
            command = 'field_selected'
        else:
            command = 'fields'
    message_id = d.new_id()
    session.add(d.MessageRow(
        id=message_id, tenant_id=channel.tenant_id, farmer_id=channel.farmer_id,
        conversation_id=conversation_id, version=1,
        payload={'id': message_id, 'conversation_id': conversation_id, 'role': 'user',
                 'text': text[:8000], 'media_ids': [], 'proposal_ids': [],
                 'source_record_ids': [], 'created_at': d.utcnow().isoformat()}))
    session.add(d.JobRow(tenant_id=channel.tenant_id, farmer_id=channel.farmer_id,
                         kind='whatsapp.inbound', status='pending', attempts=0,
                         payload={'id': d.new_id(), 'request': {
                             'external_message_id': event['external_message_id'],
                             'conversation_id': conversation_id, 'message_id': message_id,
                             'media_id': event.get('media_id'), 'media_type': event.get('type'),
                             'command': command,
                             'proposal_id': text.split(':', 1)[1].strip() if command in {'proposal_confirm', 'proposal_cancel'} else None}}))
    return 'queued'


def open_season_for(session: Session, tenant_id: str, farmer_id: str,
                    field_id: str | None) -> d.SeasonRow | None:
    """The open season on a field.

    Seasons carry no farmer_id -- they belong to a field, and the field carries the
    farmer -- so ownership is proven by the join, never by a column that does not
    exist. Three call sites here read `SeasonRow.farmer_id` anyway. They never
    raised only because each was guarded by a field the channel never set, so the
    query was never built: fixing that guard alone would have turned every one of
    these answers into a 500.
    """
    if not field_id:
        return None
    return session.scalar(
        select(d.SeasonRow)
        .join(d.FieldRow, (d.FieldRow.id == d.SeasonRow.field_id)
              & (d.FieldRow.tenant_id == d.SeasonRow.tenant_id))
        .where(d.SeasonRow.tenant_id == tenant_id, d.SeasonRow.field_id == field_id,
               d.SeasonRow.status != 'closed', d.FieldRow.farmer_id == farmer_id)
        .order_by(d.SeasonRow.id))


def active_field_id(session: Session, conversation: d.ConversationRow | None,
                    tenant_id: str, farmer_id: str) -> str | None:
    """The field an answer is about, chosen for the farmer when they have not chosen.

    A WhatsApp conversation begins with no field selected, so readiness, water and
    money each dead-ended on "no open season is available for the active field"
    until the farmer happened to run `fields` and pick one -- which is exactly the
    knowledge of the command surface that tappable navigation exists to remove.
    Falling back to their one open season means the first thing a farmer asks gets
    a real answer. The choice is remembered so it stays put, and it is only ever a
    field of their own with a season still open.
    """
    if conversation is None:
        return None
    chosen = (conversation.payload or {}).get('field_id')
    if chosen:
        return chosen
    season = session.scalar(
        select(d.SeasonRow)
        .join(d.FieldRow, (d.FieldRow.id == d.SeasonRow.field_id)
              & (d.FieldRow.tenant_id == d.SeasonRow.tenant_id))
        .where(d.SeasonRow.tenant_id == tenant_id, d.SeasonRow.status != 'closed',
               d.FieldRow.farmer_id == farmer_id, d.FieldRow.archived.is_(False))
        .order_by(d.SeasonRow.id))
    if season is None:
        return None
    conversation.payload = {**(conversation.payload or {}), 'field_id': season.field_id}
    return season.field_id


def command_reply(session: Session, settings: Settings, request: dict[str, Any], tenant_id: str,
                  farmer_id: str) -> ChannelReply | None:
    """Small deterministic channel commands; all agronomic answers stay in the assistant."""
    command = request.get('command')
    if command == 'menu':
        return menu_reply('*AgriSense*\nWhat would you like to see?')
    if command == 'fields':
        fields = list(session.scalars(select(d.FieldRow).where(
            d.FieldRow.tenant_id == tenant_id, d.FieldRow.farmer_id == farmer_id,
            d.FieldRow.archived.is_(False)).order_by(d.FieldRow.name)))
        if not fields:
            return with_menu('No fields are set up yet. Add a field in the AgriSense web app first.')
        # The field id travels in the option, so picking one is a tap and never a
        # name the farmer has to spell the way we happen to store it.
        return ChannelReply(
            body='*Your fields*\nChoose the field you want to ask about.',
            list_label='Choose field',
            options=tuple((f'field:{row.id}', row.name,
                           f'{row.area_ha} ha' if row.area_ha is not None else '')
                          for row in fields[:LIST_LIMIT]))
    if command == 'field_selected':
        message = session.get(d.MessageRow, request.get('message_id'))
        field_id = session.scalar(select(d.ConversationRow).where(
            d.ConversationRow.id == request.get('conversation_id'),
            d.ConversationRow.tenant_id == tenant_id)).payload.get('field_id') if message else None
        field = session.scalar(select(d.FieldRow).where(
            d.FieldRow.id == field_id, d.FieldRow.tenant_id == tenant_id,
            d.FieldRow.farmer_id == farmer_id)) if field_id else None
        if field is None:
            return with_menu('That field is no longer available.')
        return with_menu(f'Active field: {field.name}.',
                         ('readiness', 'Readiness'), ('water', 'Water'))
    if command == 'reminder':
        from agrisense.platform.auth import Actor
        from agrisense.platform.service import DomainService
        farmer = session.get(d.FarmerRow, farmer_id)
        if farmer is None:
            return with_menu('Your farmer account could not be found.')
        conversation = session.scalar(select(d.ConversationRow).where(
            d.ConversationRow.id == request.get('conversation_id'),
            d.ConversationRow.tenant_id == tenant_id, d.ConversationRow.farmer_id == farmer_id))
        field_id = active_field_id(session, conversation, tenant_id, farmer_id)
        season = open_season_for(session, tenant_id, farmer_id, field_id)
        if season is None:
            return with_menu('No open season is available for the active field.',
                             ('fields', 'Switch field'))
        message = session.get(d.MessageRow, request.get('message_id'))
        raw = ((message.payload if message else {}).get('text', '')).strip()[6:].strip()
        try:
            scheduled_at = datetime.fromisoformat(raw.replace('Z', '+00:00'))
            reminder = c.ReminderCreate(season_id=season.id, scheduled_at=scheduled_at,
                                        channel='whatsapp', opted_in=True)
            actor = Actor(farmer.user_id, tenant_id, farmer_id, 'farmer', True)
            DomainService(session, actor, 'whatsapp', settings=settings).execute(
                'POST', '/reminders', '', reminder, {})
        except (ValueError, PlatformError) as error:
            return with_menu(getattr(error, 'message', 'Use: remind 2026-09-12T07:00:00+05:30'))
        return with_menu(f'Reminder set for {scheduled_at.isoformat()}.')
    if command == 'close_prompt':
        # Closing a season records real harvest numbers, so it stays a typed answer:
        # there is no set of buttons that could carry a yield, a price and a date.
        return with_menu('*Close season*\nSend the harvest details in one line:\n'
                         '`close <harvest kg> <area ha> <sales ₹> <costs ₹> <YYYY-MM-DD>`\n'
                         'Example: `close 1200 1.5 90000 45000 2026-09-10`')
    if command == 'close_execute':
        from agrisense.platform.auth import Actor
        from agrisense.platform.service import DomainService
        farmer = session.get(d.FarmerRow, farmer_id)
        conversation = session.scalar(select(d.ConversationRow).where(
            d.ConversationRow.id == request.get('conversation_id'),
            d.ConversationRow.tenant_id == tenant_id, d.ConversationRow.farmer_id == farmer_id))
        field_id = active_field_id(session, conversation, tenant_id, farmer_id)
        season = open_season_for(session, tenant_id, farmer_id, field_id)
        if farmer is None or season is None:
            return with_menu('No open season is available for the active field.',
                             ('fields', 'Switch field'))
        message = session.get(d.MessageRow, request.get('message_id'))
        parts = ((message.payload if message else {}).get('text', '')).strip().split()
        if len(parts) != 6:
            return with_menu('Use: `close <harvest kg> <area ha> <sales ₹> <costs ₹> <YYYY-MM-DD>`')
        try:
            close_request = c.SeasonCloseRequest(
                expected_version=season.version, harvest_quantity_kg=float(parts[1]),
                product_form='not provided', moisture_basis='not provided',
                harvested_area_ha=float(parts[2]), realized_sales_inr=float(parts[3]),
                realized_costs_inr=float(parts[4]), harvested_on=datetime.fromisoformat(parts[5]).date())
            actor = Actor(farmer.user_id, tenant_id, farmer_id, 'farmer', True)
            summary = DomainService(session, actor, 'whatsapp', settings=settings).execute(
                'POST', '/seasons/{id}/close', season.id, close_request, {})
        except (ValueError, PlatformError) as error:
            return with_menu(getattr(error, 'message',
                                     'The close details could not be read. Check the numbers and date.'))
        warnings = getattr(summary, 'warnings', [])
        return with_menu('Season closed successfully.' + (f'\nNote: {warnings[0]}' if warnings else ''))
    if command in {'proposal_confirm', 'proposal_cancel'}:
        proposal_id = request.get('proposal_id')
        proposal = session.scalar(select(d.ProposalRow).where(
            d.ProposalRow.id == proposal_id, d.ProposalRow.tenant_id == tenant_id,
            d.ProposalRow.farmer_id == farmer_id))
        if proposal is None:
            return with_menu('That proposed action could not be found.')
        from agrisense.platform.auth import Actor
        from agrisense.platform.service import DomainService
        farmer = session.get(d.FarmerRow, farmer_id)
        if farmer is None:
            return with_menu('Your farmer account could not be found.')
        actor = Actor(farmer.user_id, tenant_id, farmer_id, 'farmer', True)
        path = '/proposals/{id}/confirm' if command == 'proposal_confirm' else '/proposals/{id}/cancel'
        try:
            DomainService(session, actor, 'whatsapp', settings=settings).execute(
                'POST', path, proposal.id, c.VersionedPatch(expected_version=proposal.version), {})
        except PlatformError as error:
            return with_menu(error.message)
        return with_menu('The proposed action was confirmed.' if command == 'proposal_confirm'
                         else 'The proposed action was cancelled.')
    conversation = session.scalar(select(d.ConversationRow).where(
        d.ConversationRow.id == request.get('conversation_id'),
        d.ConversationRow.tenant_id == tenant_id, d.ConversationRow.farmer_id == farmer_id))
    field_id = active_field_id(session, conversation, tenant_id, farmer_id)
    if command == 'history':
        rows = list(session.scalars(select(d.JournalRow).where(
            d.JournalRow.tenant_id == tenant_id, d.JournalRow.farmer_id == farmer_id)
            .order_by(d.JournalRow.occurred_at.desc()).limit(5)))
        if not rows:
            return with_menu('Nothing is recorded yet. Tell me what happened in the field and I will log it.',
                             ('journal_help', 'How to record'))
        return with_menu('*Recent field log*\n' + '\n'.join(
            f'- {row.occurred_at.date().isoformat()}: {row.payload.get("action", "observation")}'
            for row in rows), ('journal_help', 'Record something'))
    if command in {'readiness', 'water', 'money'}:
        season = open_season_for(session, tenant_id, farmer_id, field_id)
        # Named, because the farmer no longer picks the field themselves. A figure
        # about one of several plots is misleading unless it says which plot.
        field = session.get(d.FieldRow, field_id) if field_id else None
        where = f'\n_{field.name}_' if field is not None else ''
        if season is None:
            return with_menu('No open season is available for the active field. Set up a season in the web app first.',
                             ('fields', 'Switch field'))
        recommendation = session.scalar(select(d.RecommendationRow).where(
            d.RecommendationRow.tenant_id == tenant_id, d.RecommendationRow.season_id == season.id,
            d.RecommendationRow.superseded.is_(False)).order_by(d.RecommendationRow.created_at.desc()).limit(1))
        if recommendation is None:
            return with_menu('No current evaluation is available. Ask AgriSense to evaluate this season in the web app first.')
        if command == 'readiness':
            value = recommendation.payload.get('recommendation', {})
            readiness = value.get('readiness')
            status = value.get('status', 'unknown').replace('_', ' ')
            return with_menu(
                f'*Readiness: {readiness if readiness is not None else "not known"}*\n'
                f'Status: {status}{where}',
                ('water', 'Water'), ('money', 'Money'))
        key = 'water' if command == 'water' else 'economics'
        value = recommendation.payload.get(key)
        other = ('money', 'Money') if command == 'water' else ('water', 'Water')
        if not value:
            return with_menu(f'{command.title()} figures are not available for this evaluation.',
                             ('readiness', 'Readiness'))
        missing = value.get('missing_reason')
        if missing:
            # An unavailable figure says why. It is never replaced with a zero.
            return with_menu(f'{command.title()} figures are not available yet: {missing.replace("_", " ")}',
                             ('readiness', 'Readiness'))
        return with_menu(f'*{command.title()}*\n{value}{where}', ('readiness', 'Readiness'), other)
    if command == 'journal_help':
        return with_menu('*Record something*\nJust tell me what you did, in your own words — '
                         'for example "watered 2 acres today" or "sprayed for aphids". '
                         'You can send a photo or a voice note too.',
                         ('history', 'Field log'))
    return None


def journal_values(text: str) -> tuple[str, str, list[dict[str, object]]]:
    """Parse only explicit logging vocabulary; the assistant remains the free-text path."""
    body = text.strip()[4:].strip() if text.lower().startswith('log ') else text.strip()
    first, _, remainder = body.partition(' ')
    action = {
        'water': 'watered', 'watered': 'watered', 'irrigated': 'watered',
        'sprayed': 'pesticide_applied', 'spray': 'pesticide_applied',
        'fertilized': 'fertilizer_applied', 'fertilizer': 'fertilizer_applied',
        'biostimulant': 'biostimulant_applied', 'weeded': 'weed_removed',
        'harvested': 'harvest', 'harvest': 'harvest',
        'observed': 'observation', 'observation': 'observation',
    }.get(first.lower(), 'observation')
    quantities: list[dict[str, object]] = []
    for value, unit in re.findall(r'(?<![\d.])(\d+(?:\.\d+)?)\s*(mm|m3|litres?|l)\b', body.lower()):
        normalized = {'litre': 'litre', 'litres': 'litre', 'l': 'litre'}.get(unit, unit)
        quantities.append({'value': float(value), 'unit': normalized})
    return action, (remainder or body).strip()[:8000], quantities


def create_journal(session: Session, settings: Settings, request: dict[str, Any],
                   tenant_id: str, farmer_id: str, media_ids: list[str]) -> str:
    """Create an explicit WhatsApp journal entry through the normal domain service."""
    from agrisense.platform.auth import Actor
    from agrisense.platform.service import DomainService
    conversation = session.scalar(select(d.ConversationRow).where(
        d.ConversationRow.id == request.get('conversation_id'),
        d.ConversationRow.tenant_id == tenant_id, d.ConversationRow.farmer_id == farmer_id))
    field_id = (conversation.payload or {}).get('field_id') if conversation else None
    # Seasons carry no farmer_id — they belong to a field, and the field carries
    # the farmer. The previous query read `SeasonRow.farmer_id`, which does not
    # exist, so every WhatsApp journal command raised AttributeError, was
    # retried by the worker, and silently recorded nothing.
    open_seasons = (
        select(d.SeasonRow)
        .join(d.FieldRow, (d.FieldRow.id == d.SeasonRow.field_id)
              & (d.FieldRow.tenant_id == d.SeasonRow.tenant_id))
        .where(d.SeasonRow.tenant_id == tenant_id,
               d.FieldRow.farmer_id == farmer_id,
               d.SeasonRow.status != 'closed')
    )
    if field_id:
        season = session.scalar(open_seasons.where(
            d.SeasonRow.field_id == field_id).order_by(d.SeasonRow.id))
    else:
        # An inbound WhatsApp conversation carries no field until the farmer
        # picks one with `use <field name>`, so requiring one meant a plain
        # "log watered 20 mm" was silently dropped — the handler returned a
        # message and wrote nothing.
        #
        # With exactly one open season there is nothing to disambiguate and the
        # farmer plainly means that one. With several, the entry is NOT guessed:
        # attributing water or spend to the wrong field corrupts the record that
        # adherence and closure are later scored against, so they are asked.
        candidates = list(session.scalars(open_seasons.order_by(d.SeasonRow.id)))
        if len(candidates) > 1:
            return ('You have more than one season open, so tell me which field first: '
                    'reply `use <field name>`, then log it again.')
        season = candidates[0] if candidates else None
    if season is None:
        return 'No open season is available. Set up a season in the web app first.'
    source = session.get(d.MessageRow, request.get('message_id'))
    text = (source.payload or {}).get('text', '') if source else ''
    action, journal_text, quantities = journal_values(text)
    value = c.JournalCreate(
        action=action, occurred_at=d.utcnow(), text=journal_text, media_ids=media_ids,
        quantities=[c.Measurement(**item) for item in quantities])
    farmer = session.get(d.FarmerRow, farmer_id)
    if farmer is None:
        return 'Your farmer account could not be found.'
    actor = Actor(farmer.user_id, tenant_id, farmer_id, 'farmer', True)
    entry = DomainService(session, actor, 'whatsapp', settings).create_journal(
        season.id, value, source='whatsapp')
    return f'Saved to your field log: {entry.action.replace("_", " ")}. '


def whatsapp_text(text: str) -> str:
    """Convert common model Markdown into WhatsApp's small formatting dialect."""
    import re
    value = re.sub(r'^#{1,6}\s+', '*', text, flags=re.MULTILINE)
    value = value.replace('**', '*')
    value = re.sub(r'^\s*[-•]\s+', '* ', value, flags=re.MULTILINE)
    value = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'\1: \2', value)
    return value.strip()[:4000]


def download_media(settings: Settings, external_media_id: str) -> tuple[bytes, str]:
    """Resolve a Meta media id and download it with the server-side access token."""
    import httpx
    if not settings.whatsapp_access_token or not external_media_id:
        raise PlatformError('WHATSAPP_NOT_CONFIGURED', 'Media messaging is not configured.', 503, True)
    version = settings.whatsapp_graph_api_version or 'v21.0'
    headers = {'Authorization': f'Bearer {settings.whatsapp_access_token}'}
    try:
        with httpx.Client(timeout=15.0) as client:
            metadata = client.get(f'https://graph.facebook.com/{version}/{external_media_id}', headers=headers)
            metadata.raise_for_status()
            info = metadata.json()
            url = info.get('url')
            content_type = str(info.get('mime_type') or '').split(';', 1)[0].lower()
            if not url or content_type not in MEDIA_TYPES:
                raise PlatformError('WHATSAPP_MEDIA_UNSUPPORTED', 'This WhatsApp attachment type is not supported.', 422)
            response = client.get(url, headers=headers)
            response.raise_for_status()
            body = response.content
    except PlatformError:
        raise
    except httpx.HTTPError as exc:
        log.warning('whatsapp media download failed: %s', type(exc).__name__)
        raise PlatformError('WHATSAPP_MEDIA_UNAVAILABLE', 'The WhatsApp attachment could not be downloaded.', 503, True) from exc
    if len(body) > media.MAX_BYTES:
        raise PlatformError('MEDIA_TOO_LARGE', 'The WhatsApp attachment is too large.', 413)
    media.sniff(content_type, body)
    return body, content_type


def store_inbound_media(session: Session, settings: Settings, tenant_id: str,
                        farmer_id: str, external_media_id: str) -> str:
    """Download, validate, and custody one inbound Meta attachment."""
    body, content_type = download_media(settings, external_media_id)
    asset_id = d.new_id()
    key = media.object_key(tenant_id, asset_id, content_type)
    media.store(settings).write(key, body)
    digest = hashlib.sha256(body).hexdigest()
    asset = {'id': asset_id, 'content_type': content_type, 'size_bytes': len(body),
             'status': 'ready', 'captured_at': d.utcnow().isoformat(),
             'received_at': d.utcnow().isoformat(), 'version': 1}
    session.add(d.MediaRow(id=asset_id, tenant_id=tenant_id, farmer_id=farmer_id,
                           object_key=key, status='ready', sha256=digest,
                           version=1, payload=asset))
    return asset_id


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


def send_buttons(settings: Settings, recipient: str, body: str,
                 buttons: list[tuple[str, str]]) -> str:
    """Send up to three quick replies while the customer-service window is open."""
    import httpx
    if not (settings.whatsapp_access_token and settings.whatsapp_phone_number_id):
        raise PlatformError('WHATSAPP_NOT_CONFIGURED', 'Outbound messaging is not configured.', 503, True)
    payload = {'messaging_product': 'whatsapp', 'to': recipient, 'type': 'interactive',
               'interactive': {'type': 'button', 'body': {'text': whatsapp_text(body)},
                               'action': {'buttons': [
                                   {'type': 'reply', 'reply': {'id': button_id[:256], 'title': title[:20]}}
                                   for button_id, title in buttons[:3]]}}}
    try:
        response = httpx.post(graph_url(settings), headers={'Authorization': f'Bearer {settings.whatsapp_access_token}'},
                              json=payload, timeout=10.0)
        response.raise_for_status()
        return (response.json().get('messages') or [{}])[0].get('id', '')
    except httpx.HTTPError as exc:
        log.warning('whatsapp button send failed: %s', type(exc).__name__)
        raise PlatformError('WHATSAPP_SEND_FAILED', 'The message could not be sent.', 503, True) from exc


def send_list(settings: Settings, recipient: str, body: str, label: str,
              options: list[tuple[str, str, str]]) -> str:
    """Send a tappable list, for the menus that do not fit in three buttons."""
    import httpx
    if not (settings.whatsapp_access_token and settings.whatsapp_phone_number_id):
        raise PlatformError('WHATSAPP_NOT_CONFIGURED', 'Outbound messaging is not configured.', 503, True)
    rows = []
    for option_id, title, description in options[:LIST_LIMIT]:
        row: dict[str, str] = {'id': option_id[:256], 'title': title[:LIST_TITLE]}
        if description:
            row['description'] = description[:LIST_DESCRIPTION]
        rows.append(row)
    payload = {'messaging_product': 'whatsapp', 'to': recipient, 'type': 'interactive',
               'interactive': {'type': 'list', 'body': {'text': whatsapp_text(body)},
                               'action': {'button': label[:BUTTON_TITLE],
                                          'sections': [{'title': 'Options', 'rows': rows}]}}}
    try:
        response = httpx.post(graph_url(settings), headers={'Authorization': f'Bearer {settings.whatsapp_access_token}'},
                              json=payload, timeout=10.0)
        response.raise_for_status()
        return (response.json().get('messages') or [{}])[0].get('id', '')
    except httpx.HTTPError as exc:
        log.warning('whatsapp list send failed: %s', type(exc).__name__)
        raise PlatformError('WHATSAPP_SEND_FAILED', 'The message could not be sent.', 503, True) from exc


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
    body = str(payload.get('body', ''))
    options = [tuple(item) for item in payload.get('options', []) if isinstance(item, list) and len(item) == 3]
    buttons = [tuple(item) for item in payload.get('buttons', []) if isinstance(item, list) and len(item) == 2]
    # A list carries more than three choices, so it wins where both were queued.
    if options:
        send_list(settings, recipient, body, str(payload.get('list_label') or 'Choose'), options)
    elif buttons:
        send_buttons(settings, recipient, body, buttons)
    else:
        send(settings, recipient, whatsapp_text(body))
    return 'sent'


def queue_outbound(session: Session, settings: Settings, channel: d.ChannelRow,
                   body: str | ChannelReply,
                   buttons: list[tuple[str, str]] | None = None) -> d.OutboxRow:
    """Outbound messages are queued, and only sent when live mode is explicitly configured.

    A plain string is still accepted so callers that have nothing to offer beyond text
    stay unchanged; a `ChannelReply` carries its own buttons or list alongside the words.
    """
    if not channel.opted_in:
        raise PlatformError('CHANNEL_NOT_OPTED_IN', 'This channel is not opted in.', 409)
    reply = body if isinstance(body, ChannelReply) else ChannelReply(
        body=body, buttons=tuple(buttons or ()))
    within_session = channel.last_inbound_at is not None and d.aware(channel.last_inbound_at) > d.utcnow() - SESSION_WINDOW
    row = d.OutboxRow(tenant_id=channel.tenant_id, kind='whatsapp.outbound', aggregate_id=channel.id,
                      payload={'channel_id': channel.id, 'body': reply.body,
                               'requires_template': not within_session,
                               'buttons': [list(item) for item in reply.buttons],
                               'options': [list(item) for item in reply.options],
                               'list_label': reply.list_label,
                               'send_mode': settings.whatsapp_send_mode})
    session.add(row)
    return row

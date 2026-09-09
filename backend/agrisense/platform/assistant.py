"""Conversational assistant.

The model never decides anything agronomic and never writes to the database. It may only
answer from the farmer's own records, or draft a mutation that the farmer confirms through
the ordinary authenticated, version-checked route. Everything it drafts is validated against
the contract before it is stored, so an implausible or malformed suggestion is discarded
rather than shown.
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform import genai_client
from agrisense.platform.errors import PlatformError

log = logging.getLogger('agrisense.platform.assistant')
PROPOSAL_TTL = timedelta(minutes=30)
HISTORY_LIMIT = 12
# The model may only draft these, and each is re-validated and re-authorised on confirmation.
OPERATIONS = {
    'journal.create': (c.JournalCreate, d.SeasonRow),
    'field.update': (c.FieldPatch, d.FieldRow),
    'task.update': (c.TaskPatch, d.TaskRow),
    'season.close': (c.SeasonCloseRequest, d.SeasonRow),
}

INSTRUCTIONS = """You are a record-keeping assistant for an Indian farm management app.

You may do exactly two things:
1. Answer a question using only the records provided below.
2. Draft one change to those records for the farmer to confirm.

You must never give agronomic advice, never recommend applying any product, never predict
yield, weather, price or profit, and never state a number that is not present in the records.
Those judgements belong to a separate validated engine, not to you. If asked for one, say
that the app calculates it separately and offer to record what the farmer did instead.

If `attachment_unreadable` is set, a photo or recording was attached but could not be read.
Say so in one short sentence and answer what you can from the records; do not guess at what
it might have contained.

If the farmer attached a photo or a voice note it is provided with this message. A voice
note may be in any Indian language: answer in the language they spoke, and treat what they
said as the question.

For a photo, you can see it.
Describe only what is visible. You may say a leaf looks discoloured; you may not name a
disease, diagnose a deficiency, or recommend a treatment from a photograph. A photograph is
an observation to record, never a diagnosis.

If the records do not contain the answer, say so plainly. Never guess or fill a gap.

Reply with JSON only, in one of these two shapes:
{"kind": "answer", "text": "..."}
{"kind": "proposal", "text": "...", "operation": "journal.create", "target_id": "...",
 "expected_version": 1, "values": {...}}

When a voice note was attached, also include "heard": the farmer's words written out in the
language they spoke. Write only what they actually said. If the recording is unclear, give the
part you are confident of and leave the rest out rather than filling it in.

Use a proposal only when the farmer clearly asked to record or change something."""


def client(settings: Settings):
    """Resolved lazily and refused when unconfigured, so nothing is fabricated locally."""
    return genai_client.get(settings)


def grounding(session: Session, tenant_id: str, farmer_id: str, conversation: d.ConversationRow) -> dict[str, Any]:
    """Only this farmer's own records, and only the fields the assistant needs to read."""
    scope = conversation.payload
    fields = list(session.scalars(select(d.FieldRow).where(
        d.FieldRow.tenant_id == tenant_id, d.FieldRow.farmer_id == farmer_id,
        d.FieldRow.archived.is_(False)).limit(20)))
    if scope.get('field_id'):
        fields = [row for row in fields if row.id == scope['field_id']]
    field_ids = [row.id for row in fields]
    seasons = list(session.scalars(select(d.SeasonRow).where(
        d.SeasonRow.tenant_id == tenant_id, d.SeasonRow.field_id.in_(field_ids)).limit(20))) if field_ids else []
    if scope.get('season_id'):
        seasons = [row for row in seasons if row.id == scope['season_id']]
    season_ids = [row.id for row in seasons]
    journal = list(session.scalars(select(d.JournalRow).where(
        d.JournalRow.tenant_id == tenant_id, d.JournalRow.season_id.in_(season_ids))
        .order_by(d.JournalRow.occurred_at.desc()).limit(25))) if season_ids else []
    tasks = list(session.scalars(select(d.TaskRow).where(
        d.TaskRow.tenant_id == tenant_id, d.TaskRow.season_id.in_(season_ids),
        d.TaskRow.status == 'pending').limit(20))) if season_ids else []
    return {
        'today': d.utcnow().date().isoformat(),
        'language': scope.get('language', 'en'),
        'fields': [{'id': r.id, 'name': r.name, 'area_ha': r.area_ha, 'version': r.version} for r in fields],
        'seasons': [{'id': r.id, 'field_id': r.field_id, 'crop_id': r.crop_id, 'status': r.status,
                     'allocated_area_ha': r.allocated_area_ha, 'version': r.version} for r in seasons],
        'journal': [{'id': r.id, 'season_id': r.season_id, 'action': r.payload.get('action'),
                     'occurred_at': r.payload.get('occurred_at'), 'text': r.payload.get('text', '')[:400]}
                    for r in journal],
        'pending_tasks': [{'id': r.id, 'season_id': r.season_id, 'title': r.payload.get('title'),
                           'version': r.version} for r in tasks],
    }


def history(session: Session, conversation_id: str, tenant_id: str) -> list[dict[str, str]]:
    rows = list(session.scalars(select(d.MessageRow).where(
        d.MessageRow.tenant_id == tenant_id, d.MessageRow.conversation_id == conversation_id)
        .order_by(d.MessageRow.created_at.desc()).limit(HISTORY_LIMIT)))
    return [{'role': row.payload.get('role', 'user'), 'text': row.payload.get('text', '')[:2000]}
            for row in reversed(rows)]


def ask(settings: Settings, records: dict[str, Any], turns: list[dict[str, str]],
        images: list[tuple[bytes, str]] | None = None) -> dict[str, Any]:
    prompt = json.dumps({'records': records, 'conversation': turns}, separators=(',', ':'))
    model = client(settings)
    contents: list[Any] = [prompt]
    if images:
        from google.genai import types
        # The farmer attached these to this turn, so the model is given them directly
        # rather than being told a photo exists that it cannot see.
        contents = [types.Part.from_bytes(data=data, mime_type=kind) for data, kind in images] + [prompt]
    response = model.models.generate_content(
        model=settings.gemini_model,
        contents=contents,
        config={'system_instruction': INSTRUCTIONS, 'response_mime_type': 'application/json',
                'temperature': 0.2, 'max_output_tokens': 4096})
    text = getattr(response, 'text', '') or ''
    if not text.strip():
        # An empty body usually means the output budget was spent before any JSON was emitted.
        raise PlatformError('ASSISTANT_UNREADABLE', 'The assistant could not answer. Please try again.', 503, True)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise PlatformError('ASSISTANT_UNREADABLE', 'The assistant could not answer. Please try again.',
                            503, True) from exc
    if not isinstance(parsed, dict) or parsed.get('kind') not in ('answer', 'proposal'):
        raise PlatformError('ASSISTANT_UNREADABLE', 'The assistant could not answer. Please try again.', 503, True)
    return parsed


MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
VIEWABLE = ('image/jpeg', 'image/png', 'image/webp')
# Gemini accepts audio directly, so a spoken question needs no separate transcription step.
AUDIBLE = ('audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav')


def attachments(session: Session, settings: Settings, tenant_id: str, farmer_id: str,
                message_id: str) -> list[tuple[bytes, str]]:
    """Images the farmer attached to this turn, read from their own media only."""
    row = session.scalar(select(d.MessageRow).where(
        d.MessageRow.id == message_id, d.MessageRow.tenant_id == tenant_id,
        d.MessageRow.farmer_id == farmer_id))
    if row is None:
        return []
    images: list[tuple[bytes, str]] = []
    for media_id in (row.payload or {}).get('media_ids', [])[:3]:
        asset = session.scalar(select(d.MediaRow).where(
            d.MediaRow.id == media_id, d.MediaRow.tenant_id == tenant_id,
            d.MediaRow.farmer_id == farmer_id, d.MediaRow.status == 'ready'))
        if asset is None:
            continue
        kind = (asset.payload or {}).get('content_type', '')
        if kind not in VIEWABLE + AUDIBLE or (asset.payload or {}).get('size_bytes', 0) > MAX_ATTACHMENT_BYTES:
            continue
        try:
            from agrisense.platform import media
            images.append((media.store(settings).read(asset.object_key), kind))
        except Exception:
            # A photo that cannot be read is simply not shown to the model.
            log.warning('attached media could not be read for the assistant')
    return images


def build_proposal(session: Session, tenant_id: str, farmer_id: str, conversation_id: str,
                   message_id: str, drafted: dict[str, Any]) -> d.ProposalRow:
    """A draft is only stored once it validates and the target is genuinely the farmer's own."""
    operation = drafted.get('operation')
    if operation not in OPERATIONS:
        raise PlatformError('ASSISTANT_UNSUPPORTED_OPERATION', 'That change cannot be proposed.', 422)
    model, table = OPERATIONS[operation]
    target = session.scalar(select(table).where(table.id == drafted.get('target_id', ''),
                                                table.tenant_id == tenant_id))
    if target is None or (hasattr(target, 'farmer_id') and target.farmer_id != farmer_id):
        # A hallucinated identifier must never become a proposal against a real record.
        raise PlatformError('ASSISTANT_UNKNOWN_TARGET', 'That record could not be found.', 422)
    raw = drafted.get('values') or {}
    if not isinstance(raw, dict):
        raise PlatformError('ASSISTANT_UNSUPPORTED_OPERATION', 'That change cannot be proposed.', 422)
    # The model tends to repeat identifiers the target already carries. Narrowing to the
    # model's own fields drops those without letting anything unexpected through, since
    # validation still runs and the target is resolved from target_id rather than the body.
    values = model.model_validate({k: v for k, v in raw.items() if k in model.model_fields})
    proposal = c.ProposedMutation(
        id=d.new_id(), conversation_id=conversation_id, message_id=message_id, operation=operation,
        target_id=target.id, expected_version=target.version, old_values={}, new_values=values,
        expires_at=d.utcnow() + PROPOSAL_TTL, status='pending', version=1)
    row = d.ProposalRow(id=proposal.id, tenant_id=tenant_id, farmer_id=farmer_id,
                        conversation_id=conversation_id, status='pending',
                        expires_at=proposal.expires_at, version=1,
                        payload=proposal.model_dump(mode='json'))
    session.add(row)
    return row


def reply(session: Session, settings: Settings, tenant_id: str, farmer_id: str,
          conversation_id: str, message_id: str) -> d.MessageRow:
    """Produce one assistant turn. Raises when the model is unavailable rather than inventing one."""
    conversation = session.scalar(select(d.ConversationRow).where(
        d.ConversationRow.id == conversation_id, d.ConversationRow.tenant_id == tenant_id,
        d.ConversationRow.farmer_id == farmer_id))
    if conversation is None:
        raise PlatformError('CONVERSATION_MISSING', 'This conversation no longer exists.', 404)
    records = grounding(session, tenant_id, farmer_id, conversation)
    media_parts = attachments(session, settings, tenant_id, farmer_id, message_id)
    if media_parts:
        records['attachments'] = len(media_parts)
    turns = history(session, conversation_id, tenant_id)
    try:
        drafted = ask(settings, records, turns, media_parts)
    except PlatformError:
        raise
    except Exception:
        if not media_parts:
            raise
        # The model rejected the attachment: a truncated recording, or a file that is not
        # the audio it claims to be. Answering without it beats failing the whole reply,
        # and the farmer is told rather than left wondering why it was ignored.
        log.warning('assistant retrying without an attachment the model would not accept')
        records['attachment_unreadable'] = True
        drafted = ask(settings, records, turns, None)

    proposal_ids: list[str] = []
    if drafted['kind'] == 'proposal':
        try:
            proposal_ids.append(build_proposal(session, tenant_id, farmer_id, conversation_id,
                                               message_id, drafted).id)
        except (PlatformError, ValidationError) as error:
            # An unusable draft degrades to a plain answer; it is never applied or shown as a
            # change, and a malformed one must not fail the whole reply.
            log.info('assistant proposal discarded: %s', type(error).__name__)
            drafted['text'] = drafted.get('text') or 'I could not prepare that change. Please make it directly.'

    # A voice note leaves the farmer's own turn blank on screen. Writing back what was
    # heard lets them read their question and check it was understood correctly.
    heard = drafted.get('heard')
    if isinstance(heard, str) and heard.strip():
        asked = session.scalar(select(d.MessageRow).where(
            d.MessageRow.id == message_id, d.MessageRow.tenant_id == tenant_id))
        if asked is not None and not (asked.payload or {}).get('text', '').strip():
            asked.payload = {**asked.payload, 'text': heard.strip()[:8000]}

    message = c.Message(id=d.new_id(), conversation_id=conversation_id, role='assistant',
                        text=str(drafted.get('text', ''))[:8000], created_at=d.utcnow(),
                        proposal_ids=proposal_ids)
    row = d.MessageRow(id=message.id, tenant_id=tenant_id, farmer_id=farmer_id,
                       conversation_id=conversation_id, version=1,
                       payload=message.model_dump(mode='json'))
    session.add(row)
    return row

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
from agrisense.platform import genai_client, vision
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

`current_evaluation` is that engine's own output for this farmer's open season. Reading a
figure out of it is reporting, not advising, so you may quote what is there -- the stage,
whether irrigation is needed, the volume of one watering, the season's return -- and say
where it came from. Do not extrapolate from it, do not convert a figure into an instruction
the engine did not give, and if a field is null say it has not been worked out yet. The
litres are one watering's worth and alternatives across days: never call them a daily total.
Declining to read out a number the app already shows on screen is unhelpful and wrong.

You also know what AgriSense is, and questions about it are not agronomic advice.
Answer them from this description, plainly, in one or two sentences:

AgriSense helps a farmer decide what to sow, when to water, and when it is safe to spray.
It works from a farmer's own field: its location, its soil, the crop and when it was sown.
It can
  - compare crops for a field and rank them on suitability, water need, season length and an
    indicative return, from Punjab Agricultural University sowing calendars and FAO water figures;
  - work out a water plan from the field's soil and a live forecast, and say how much one
    watering needs and whether it is needed now;
  - work out heat, cold and drought stress day by day over the coming forecast, and name a
    safe window for a foliar spray when wind, temperature, humidity and rain allow one;
  - show what the crop is fetching at mandis today, with the season's declared support price;
  - keep a field diary the farmer can add to here, by photo or by voice note, in their language;
  - work over WhatsApp as well as the web app, in English, Hindi, Marathi, Punjabi and Telugu.

It is at https://agrisense.spacesdrive.cc and these are its screens. When a farmer asks how
to reach one, give the link:
  - dashboard, your field and today's advice: https://agrisense.spacesdrive.cc/
  - compare crops for a field: https://agrisense.spacesdrive.cc/plan-crop/
  - the seven day plan and spray windows: https://agrisense.spacesdrive.cc/plan/
  - when it is safe to spray: https://agrisense.spacesdrive.cc/readiness/
  - water plan: https://agrisense.spacesdrive.cc/water/
  - field diary, to record what you did: https://agrisense.spacesdrive.cc/journal/
  - money, costs and mandi prices: https://agrisense.spacesdrive.cc/money/
  - ask AgriSense, this conversation on the web: https://agrisense.spacesdrive.cc/ask/
  - close the season and record the harvest: https://agrisense.spacesdrive.cc/close-season/
  - account, language and WhatsApp: https://agrisense.spacesdrive.cc/account/
  - how the advice is worked out: https://agrisense.spacesdrive.cc/algorithm-notes/

It is in five languages: English, Hindi (हिंदी), Marathi (मराठी), Punjabi (ਪੰਜਾਬੀ) and Telugu
(తెలుగు). A farmer changes it from the language buttons on any screen, or on the account page.

These facts about AgriSense are yours to state directly. Do not say the records do not
contain them: the records are the farmer's own fields and diary, and this is the app around
them.

Say plainly what it will not do: it does not guess. Where a figure needs something nobody has
recorded, it says so rather than inventing a number, and a spray window is only named when
the weather actually allows one. If the farmer asks something about AgriSense not covered
here, say you are not sure rather than inventing a feature.

If `attachment_unreadable` is set, a photo or recording was attached but could not be read.
Say so in one short sentence and answer what you can from the records; do not guess at what
it might have contained.

If the farmer attached a photo or a voice note it is provided with this message. A voice
note may be in any Indian language: answer in the language they spoke, and treat what they
said as the question.

For a photo, you can see it. If `photo_observations` is present, a separate crop-vision
model looked at the same photo and these are its labels with confidences. Treat them as one
more observation, not as fact and not as a diagnosis: you may mention what the model noticed
and its confidence, and you must not name a disease, declare a deficiency, or recommend a
treatment on that basis. A low confidence should be described as uncertain rather than
repeated as though it were settled.
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
    # The current evaluation, so a question about water or readiness is answered
    # from this farmer's own figures instead of declined. Without it the
    # assistant had fields and a journal but none of the numbers the rest of the
    # app shows, so "how much water does my maize need" -- a question the app
    # answers on screen -- came back as "I cannot provide agronomic advice".
    latest = session.scalar(select(d.RecommendationRow).where(
        d.RecommendationRow.tenant_id == tenant_id,
        d.RecommendationRow.season_id.in_(season_ids),
        d.RecommendationRow.superseded.is_(False))
        .order_by(d.RecommendationRow.created_at.desc()).limit(1)) if season_ids else None
    evaluation = None
    if latest is not None:
        payload = latest.payload or {}
        water = payload.get('water') or {}
        recommendation = payload.get('recommendation') or {}
        economics = payload.get('economics') or {}
        evaluation = {
            'season_id': latest.season_id,
            'stage': recommendation.get('stage'),
            'readiness': recommendation.get('readiness'),
            'status': recommendation.get('status'),
            'irrigation_needed': water.get('irrigation_needed'),
            # One watering's worth, not a daily rate: these are alternatives.
            'one_watering_litres': next(
                (row.get('value') for row in water.get('daily') or []
                 if row.get('value') is not None), None),
            'season_profit_inr_p50': (economics.get('profit') or {}).get('p50'),
            'season_roi_percent_p50': (economics.get('roi') or {}).get('p50'),
        }
    return {
        'today': d.utcnow().date().isoformat(),
        'language': scope.get('language', 'en'),
        'current_evaluation': evaluation,
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
                message_id: str, labels: list[dict[str, object]] | None = None
                ) -> list[tuple[bytes, str]]:
    """Media the farmer attached to this turn, read from their own records only.

    Photographs are preprocessed and, where a reviewed model is deployed, labelled.
    `labels` collects those observations for the caller to pass as context.
    """
    labels = labels if labels is not None else []
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
            raw = media.store(settings).read(asset.object_key)
        except Exception:
            # A photo that cannot be read is simply not shown to the model.
            log.warning('attached media could not be read for the assistant')
            continue
        if kind in VIEWABLE:
            raw, kind = vision.preprocess(raw, kind)
            labels.extend(vision.classify(settings, raw, kind))
        images.append((raw, kind))
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
    labels: list[dict[str, object]] = []
    media_parts = attachments(session, settings, tenant_id, farmer_id, message_id, labels)
    if media_parts:
        records['attachments'] = len(media_parts)
    if labels:
        # Model output, carried as an observation with its confidence. The
        # instructions forbid treating it as a diagnosis.
        records['photo_observations'] = labels
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

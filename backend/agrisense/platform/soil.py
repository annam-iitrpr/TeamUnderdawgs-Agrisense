"""Soil health card extraction.

A card is transcribed, never interpreted. The model reads printed values off an image; it
does not decide whether a soil is deficient, and it does not fill in a value that is not on
the card. Everything it reads lands as a draft the farmer confirms, because a misread decimal
point changes a fertiliser decision.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from agrisense.config import Settings
from agrisense.contracts_generated import models as c
from agrisense.platform import db as d
from agrisense.platform import genai_client, media
from agrisense.platform.errors import PlatformError, unavailable

log = logging.getLogger('agrisense.platform.soil')

INSTRUCTIONS = """You transcribe Indian Soil Health Card documents. You do not interpret them.

Read only what is printed. For every field you cannot read clearly, use null and say why in
missing_reason. Never estimate, never infer from a typical value, never convert units you are
not certain about. A wrong digit here changes what a farmer applies to a field.

Return JSON only:
{"sampled_on": "YYYY-MM-DD or null",
 "ph": {"value": number or null, "unit": "pH", "missing_reason": "..." or null},
 "organic_carbon": {"value": number or null, "unit": "%", "missing_reason": null},
 "nitrogen": {"value": number or null, "unit": "kg/ha", "missing_reason": null},
 "phosphorus": {"value": number or null, "unit": "kg/ha", "missing_reason": null},
 "potassium": {"value": number or null, "unit": "kg/ha", "missing_reason": null},
 "texture": "string or null",
 "transcription_notes": "anything ambiguous about this card"}

If the image is not a soil health card, return {"not_a_soil_card": true} and nothing else."""

MEASURED = ('ph', 'organic_carbon', 'nitrogen', 'phosphorus', 'potassium')


def client(settings: Settings):
    return genai_client.get(settings)


def read_card(settings: Settings, data: bytes, content_type: str) -> dict[str, Any]:
    from google.genai import types
    try:
        model = client(settings)
        response = model.models.generate_content(
            model=settings.gemini_model,
            contents=[types.Part.from_bytes(data=data, mime_type=content_type), 'Transcribe this card.'],
            config={'system_instruction': INSTRUCTIONS, 'response_mime_type': 'application/json',
                    'temperature': 0.0, 'max_output_tokens': 2048})
        parsed = json.loads(getattr(response, 'text', '') or '')
    except json.JSONDecodeError as exc:
        raise PlatformError('SOIL_CARD_UNREADABLE', 'This card could not be read. Try a clearer photo.',
                            422) from exc
    except Exception as exc:
        log.exception('soil extraction failed')
        raise unavailable('Soil card extraction') from exc
    if not isinstance(parsed, dict):
        raise PlatformError('SOIL_CARD_UNREADABLE', 'This card could not be read. Try a clearer photo.', 422)
    if parsed.get('not_a_soil_card'):
        raise PlatformError('NOT_A_SOIL_CARD', 'This does not look like a soil health card.', 422)
    return parsed


def measurement(raw: Any, analyte: str) -> c.Measurement | None:
    """A reading only survives if it is a real number with a unit; anything else is unknown."""
    if not isinstance(raw, dict):
        return None
    value = raw.get('value')
    unit = raw.get('unit')
    if not isinstance(unit, str) or not unit:
        return None
    if value is not None and not isinstance(value, int | float):
        value = None
    if isinstance(value, bool):
        value = None
    reason = raw.get('missing_reason') if isinstance(raw.get('missing_reason'), str) else None
    if value is None and not reason:
        reason = 'not_legible_on_card'
    return c.Measurement(value=value, unit=unit, analyte=analyte, method='soil_health_card_ocr',
                         missing_reason=reason,
                         provenance=[c.Provenance(source='soil_health_card', data_mode='estimated',
                                                  note='Transcribed from a photograph; confirm before use.')])


def to_observation(parsed: dict[str, Any], field_id: str, media_id: str) -> c.SoilObservation:
    """Always a draft. A transcription is a claim about a photograph, not a confirmed fact."""
    sampled = parsed.get('sampled_on')
    fields: dict[str, Any] = {}
    for name in MEASURED:
        reading = measurement(parsed.get(name), name)
        if reading is not None:
            fields[name] = reading
    return c.SoilObservation(
        id=d.new_id(), field_id=field_id,
        sampled_on=sampled if isinstance(sampled, str) and len(sampled) == 10 else None,
        texture=parsed.get('texture') if isinstance(parsed.get('texture'), str) else None,
        source='farmer', confirmation_state='draft', attachment_id=media_id,
        original_ocr=json.dumps(parsed, separators=(',', ':'))[:8000], version=1, **fields)


def extract(session: Session, settings: Settings, tenant_id: str, farmer_id: str,
            field_id: str, media_id: str) -> str:
    asset = session.scalar(select(d.MediaRow).where(
        d.MediaRow.id == media_id, d.MediaRow.tenant_id == tenant_id, d.MediaRow.farmer_id == farmer_id))
    if asset is None:
        raise PlatformError('NOT_FOUND', 'This record was not found.', 404)
    if asset.status != 'ready':
        raise PlatformError('MEDIA_NOT_READY', 'Complete the upload before extraction.', 409)
    content_type = (asset.payload or {}).get('content_type', 'image/jpeg')
    parsed = read_card(settings, media.store(settings).read(asset.object_key), content_type)
    observation = to_observation(parsed, field_id, media_id)
    session.add(d.SoilRow(id=observation.id, tenant_id=tenant_id, farmer_id=farmer_id,
                          field_id=field_id, version=1, payload=observation.model_dump(mode='json')))
    return observation.id

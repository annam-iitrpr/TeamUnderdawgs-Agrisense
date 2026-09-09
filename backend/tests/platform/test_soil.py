"""A soil card is transcribed, never interpreted, and always lands as a draft."""
from __future__ import annotations

import json

import pytest
from agrisense.contracts_generated import models as c
from agrisense.platform import soil
from agrisense.platform.errors import PlatformError

CARD = {'sampled_on': '2026-06-15',
        'ph': {'value': 7.4, 'unit': 'pH', 'missing_reason': None},
        'organic_carbon': {'value': 0.52, 'unit': '%', 'missing_reason': None},
        'nitrogen': {'value': 240.0, 'unit': 'kg/ha', 'missing_reason': None},
        'phosphorus': {'value': None, 'unit': 'kg/ha', 'missing_reason': 'smudged on the card'},
        'potassium': {'value': 310.0, 'unit': 'kg/ha', 'missing_reason': None},
        'texture': 'clay loam',
        'transcription_notes': 'phosphorus row is partly obscured'}


def test_a_transcription_becomes_a_draft_never_a_confirmed_fact():
    observation = soil.to_observation(CARD, 'field-1', 'media-1')
    assert observation.confirmation_state == 'draft'
    assert observation.source == 'farmer'
    assert observation.attachment_id == 'media-1'
    assert observation.ph.value == 7.4 and observation.ph.analyte == 'ph'
    assert observation.ph.provenance[0].data_mode == 'estimated'
    # The original reading is kept so a farmer can check the transcription against the photo.
    assert 'phosphorus row is partly obscured' in observation.original_ocr


def test_an_unreadable_value_stays_unknown_with_a_reason_never_zero():
    observation = soil.to_observation(CARD, 'field-1', 'media-1')
    assert observation.phosphorus.value is None
    assert observation.phosphorus.missing_reason == 'smudged on the card'
    # A value the model omitted entirely is absent, not invented as zero.
    partial = soil.to_observation({k: v for k, v in CARD.items() if k != 'potassium'}, 'f', 'm')
    assert partial.potassium is None


def test_a_reading_that_is_not_a_number_is_discarded_rather_than_coerced():
    for bad in ({'value': 'about seven', 'unit': 'pH'}, {'value': True, 'unit': 'pH'}):
        reading = soil.measurement(bad, 'ph')
        assert reading.value is None and reading.missing_reason
    # No unit means the number cannot be interpreted at all.
    assert soil.measurement({'value': 7.4}, 'ph') is None
    assert soil.measurement('7.4', 'ph') is None


def test_a_missing_value_without_a_stated_reason_still_records_one():
    reading = soil.measurement({'value': None, 'unit': 'pH'}, 'ph')
    assert reading.value is None and reading.missing_reason == 'not_legible_on_card'


def test_a_photo_that_is_not_a_card_is_refused_rather_than_transcribed(monkeypatch):
    from agrisense.config import Settings

    class Response:
        text = json.dumps({'not_a_soil_card': True})

    class Models:
        def generate_content(self, **kwargs): return Response()

    class Client:
        models = Models()

    monkeypatch.setattr(soil, 'client', lambda settings: Client())
    with pytest.raises(PlatformError) as raised:
        soil.read_card(Settings(app_env='test'), b'x', 'image/jpeg')
    assert raised.value.code == 'NOT_A_SOIL_CARD'


def test_without_a_configured_model_extraction_reports_its_dependency(harness):
    from agrisense.config import Settings
    with pytest.raises(PlatformError) as raised:
        soil.client(Settings(app_env='test', gemini_api_key='', gemini_model=''))
    assert raised.value.code == 'DEPENDENCY_UNAVAILABLE'


def test_an_invalid_sampling_date_is_dropped_rather_than_guessed():
    assert soil.to_observation({**CARD, 'sampled_on': 'last monsoon'}, 'f', 'm').sampled_on is None
    assert soil.to_observation({**CARD, 'sampled_on': None}, 'f', 'm').sampled_on is None
    assert str(soil.to_observation(CARD, 'f', 'm').sampled_on) == '2026-06-15'


def test_the_draft_satisfies_the_contract():
    observation = soil.to_observation(CARD, 'field-1', 'media-1')
    assert c.SoilObservation.model_validate(observation.model_dump(mode='json'))

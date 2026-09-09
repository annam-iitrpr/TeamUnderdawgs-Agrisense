"""Preprocessing always runs; classification only when a reviewed model is deployed."""
from __future__ import annotations

import io

from agrisense.config import Settings
from agrisense.platform import vision


def photo(width: int, height: int) -> bytes:
    from PIL import Image
    buffer = io.BytesIO()
    Image.new('RGB', (width, height), (34, 120, 60)).save(buffer, format='PNG')
    return buffer.getvalue()


def test_a_large_phone_photo_is_downscaled_and_re_encoded():
    original = photo(4000, 3000)
    data, kind = vision.preprocess(original, 'image/png')
    assert kind == 'image/jpeg'
    assert len(data) < len(original)
    from PIL import Image
    with Image.open(io.BytesIO(data)) as image:
        assert max(image.size) == vision.MAX_EDGE_PX
        # Aspect ratio is preserved: a stretched leaf is harder to read, not easier.
        assert abs(image.size[0] / image.size[1] - 4000 / 3000) < 0.01


def test_a_small_photo_is_not_upscaled():
    from PIL import Image
    data, _ = vision.preprocess(photo(320, 240), 'image/png')
    with Image.open(io.BytesIO(data)) as image:
        assert image.size == (320, 240)


def test_a_file_that_is_not_an_image_is_returned_untouched():
    data, kind = vision.preprocess(b'this is not an image', 'image/png')
    assert data == b'this is not an image' and kind == 'image/png'


def test_no_model_means_no_labels_rather_than_a_guess():
    settings = Settings(app_env='test', vertex_vision_endpoint='')
    assert vision.configured(settings) is False
    assert vision.classify(settings, photo(64, 64), 'image/png') == []


def test_labels_below_the_confidence_floor_are_dropped():
    payload = {'predictions': [{
        'displayNames': ['leaf_spot', 'healthy', 'blur'],
        'confidences': [0.91, 0.42, 0.02],
    }]}
    labels = vision.normalise(payload)
    assert [item['label'] for item in labels] == ['leaf_spot', 'healthy']
    assert labels[0]['confidence'] == 0.91


def test_labels_are_ordered_by_confidence_and_capped():
    payload = {'predictions': [{
        'displayNames': [f'label-{i}' for i in range(9)],
        'confidences': [0.4 + i / 100 for i in range(9)],
    }]}
    labels = vision.normalise(payload)
    assert len(labels) == vision.MAX_LABELS
    assert [item['confidence'] for item in labels] == sorted(
        (item['confidence'] for item in labels), reverse=True)


def test_a_malformed_or_empty_prediction_yields_nothing():
    for payload in (
        None, {}, {'predictions': []}, {'predictions': [None]},
        {'predictions': [{'displayNames': 'not-a-list', 'confidences': [1]}]},
        {'predictions': [{'displayNames': ['x'], 'confidences': ['high']}]},
        {'predictions': [{'displayNames': ['x'], 'confidences': [1.4]}]},
        {'predictions': [{'displayNames': ['x'], 'confidences': [True]}]},
    ):
        assert vision.normalise(payload) == []


def test_a_vision_outage_never_costs_the_answer(monkeypatch):
    """The photo still reaches the language model, just without labels."""
    settings = Settings(app_env='test', vertex_vision_endpoint='1234',
                        google_cloud_project='p', vision_location='asia-south1')
    assert vision.configured(settings) is True

    def explode(*_args, **_kwargs):
        raise RuntimeError('endpoint down')

    monkeypatch.setattr('google.auth.default', explode)
    assert vision.classify(settings, photo(64, 64), 'image/png') == []

"""Image preprocessing and the optional crop-vision model.

Two stages sit between a farmer's photo and the language model.

Preprocessing always runs: a phone photo is many megabytes at a resolution no
model needs, and shipping it whole wastes the farmer's data and the request
budget. It is decoded, downscaled and re-encoded, which also means a file that
only claims to be an image fails here rather than downstream.

Classification runs only when a reviewed model is actually deployed. There is no
fallback classifier and no default labels: an untrained guess about a farmer's
crop would be worse than saying nothing, so when no endpoint is configured the
photo simply goes to the language model unlabelled.

Whatever a model returns is an observation with a confidence, never a diagnosis.
Nothing here decides that a plant is diseased or what to apply to it.
"""
from __future__ import annotations

import base64
import io
import logging

from agrisense.config import Settings

log = logging.getLogger('agrisense.platform.vision')

# Large enough for canopy and leaf detail, small enough to send over a rural connection.
MAX_EDGE_PX = 1280
JPEG_QUALITY = 82
PREPROCESSED_TYPE = 'image/jpeg'
# A label the model is not reasonably sure about is noise, and noise in a prompt
# is worse than silence because it reads as evidence.
MIN_CONFIDENCE = 0.35
MAX_LABELS = 5
TIMEOUT_SECONDS = 20.0


def preprocess(data: bytes, content_type: str) -> tuple[bytes, str]:
    """Downscale and re-encode. Returns the original bytes if it cannot be done."""
    try:
        from PIL import Image
    except ImportError:
        return data, content_type
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            # EXIF orientation matters: a sideways leaf is harder for any model to read.
            try:
                from PIL import ImageOps
                image = ImageOps.exif_transpose(image) or image
            except Exception:
                pass
            if image.mode not in ('RGB', 'L'):
                image = image.convert('RGB')
            if max(image.size) > MAX_EDGE_PX:
                image.thumbnail((MAX_EDGE_PX, MAX_EDGE_PX), Image.LANCZOS)
            buffer = io.BytesIO()
            image.save(buffer, format='JPEG', quality=JPEG_QUALITY, optimize=True)
            return buffer.getvalue(), PREPROCESSED_TYPE
    except Exception:
        # An unreadable image is left alone; the caller's own checks still apply.
        log.info('image preprocessing skipped for an undecodable file')
        return data, content_type


def configured(settings: Settings) -> bool:
    return bool(settings.vertex_vision_endpoint and settings.vision_project)


def classify(settings: Settings, data: bytes, content_type: str) -> list[dict[str, object]]:
    """Ask the deployed model what it sees. An empty list means nothing usable."""
    if not configured(settings):
        return []
    try:
        import google.auth
        import google.auth.transport.requests
        import httpx
    except ImportError:
        return []
    try:
        credentials, _ = google.auth.default(
            scopes=['https://www.googleapis.com/auth/cloud-platform'])
        credentials.refresh(google.auth.transport.requests.Request())
        location = settings.vision_location or 'asia-south1'
        url = (f'https://{location}-aiplatform.googleapis.com/v1/projects/'
               f'{settings.vision_project}/locations/{location}/endpoints/'
               f'{settings.vertex_vision_endpoint}:predict')
        response = httpx.post(
            url,
            headers={'Authorization': f'Bearer {credentials.token}'},
            json={'instances': [{'content': base64.b64encode(data).decode(),
                                 'mimeType': content_type}]},
            timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
        payload = response.json()
    except Exception:
        # A vision outage must not cost the farmer their answer; the photo still
        # reaches the language model, just without labels.
        log.warning('crop vision model unavailable; continuing without labels')
        return []
    return normalise(payload)


def normalise(payload: object) -> list[dict[str, object]]:
    """Accept the common Vertex shapes without inventing anything absent."""
    if not isinstance(payload, dict):
        return []
    predictions = payload.get('predictions')
    if not isinstance(predictions, list) or not predictions:
        return []
    first = predictions[0]
    if not isinstance(first, dict):
        return []
    names = first.get('displayNames') or first.get('labels') or first.get('classes')
    scores = first.get('confidences') or first.get('scores')
    if not isinstance(names, list) or not isinstance(scores, list):
        return []
    labels: list[dict[str, object]] = []
    for name, score in zip(names, scores, strict=False):
        if not isinstance(name, str) or not isinstance(score, int | float):
            continue
        if isinstance(score, bool) or not 0 <= float(score) <= 1:
            continue
        if float(score) < MIN_CONFIDENCE:
            continue
        labels.append({'label': name, 'confidence': round(float(score), 3)})
    labels.sort(key=lambda item: item['confidence'], reverse=True)
    return labels[:MAX_LABELS]

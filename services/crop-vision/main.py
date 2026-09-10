"""Crop-vision service.

Serves one PlantVillage-derived MobileNetV2 classifier over HTTP. It exists so
the platform has a real model behind its vision seam; it is not, and must not be
presented as, a diagnosis.

Two limits matter and are returned with every response rather than buried in a
document. The model was trained on laboratory photographs of detached leaves on
plain backgrounds, so a real field photo with soil, sky and several plants in it
is outside what it learned. And its own held-out accuracy is 78.6%, meaning
roughly one in five of its answers is wrong even on the data it was built for.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s: %(message)s')
log = logging.getLogger('crop-vision')

MODEL_DIR = Path(__file__).parent / 'model'
IMAGE_SIZE = 224
RESIZE_EDGE = 256
# Matches the preprocessor the weights were trained with; changing either alone
# silently degrades every prediction.
MEAN = np.array([0.5, 0.5, 0.5], dtype=np.float32)
STD = np.array([0.5, 0.5, 0.5], dtype=np.float32)

MODEL_CARD = {
    'model': 'mobilenet_v2_1.0_224-plant-disease-identification',
    'source': 'https://huggingface.co/linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification',
    'training_data': 'New Plant Diseases Dataset (PlantVillage derived)',
    'held_out_accuracy': 0.786,
    'limitations': [
        'trained_on_laboratory_images_not_field_photographs',
        'single_detached_leaf_on_plain_background',
        'labels_cover_38_classes_and_not_all_indian_crops',
        'never_a_diagnosis_or_a_treatment_recommendation',
    ],
}

app = FastAPI(title='AgriSense crop vision', docs_url=None, redoc_url=None, openapi_url=None)
_session: ort.InferenceSession | None = None
_labels: dict[str, str] = {}


def session() -> ort.InferenceSession:
    global _session, _labels
    if _session is None:
        _labels = json.loads((MODEL_DIR / 'labels.json').read_text())['id2label']
        _session = ort.InferenceSession(
            str(MODEL_DIR / 'model.onnx'), providers=['CPUExecutionProvider'])
        log.info('model loaded with %d labels', len(_labels))
    return _session


def preprocess(data: bytes) -> np.ndarray:
    """Resize, centre crop and normalise exactly as the model was trained."""
    with Image.open(io.BytesIO(data)) as image:
        image = ImageOps.exif_transpose(image) or image
        image = image.convert('RGB')
        width, height = image.size
        scale = RESIZE_EDGE / min(width, height)
        image = image.resize((round(width * scale), round(height * scale)), Image.BILINEAR)
        left = (image.width - IMAGE_SIZE) // 2
        top = (image.height - IMAGE_SIZE) // 2
        image = image.crop((left, top, left + IMAGE_SIZE, top + IMAGE_SIZE))
        array = np.asarray(image, dtype=np.float32) / 255.0
    array = (array - MEAN) / STD
    return array.transpose(2, 0, 1)[None]


class Instance(BaseModel):
    content: str = Field(description='Base64-encoded image bytes')
    mimeType: str | None = None


class PredictRequest(BaseModel):
    instances: list[Instance]


@app.get('/health/live')
def live() -> dict[str, str]:
    return {'status': 'ok'}


@app.get('/health/ready')
def ready() -> dict[str, object]:
    session()
    return {'status': 'ready', 'labels': len(_labels)}


@app.get('/model-card')
def card() -> dict[str, object]:
    return MODEL_CARD


@app.post('/predict')
def predict(request: PredictRequest) -> dict[str, object]:
    """Vertex-shaped response, so the platform can point at either without a change."""
    if not request.instances:
        return {'predictions': [], 'modelCard': MODEL_CARD}
    try:
        pixels = preprocess(base64.b64decode(request.instances[0].content))
    except Exception:
        # An unreadable image is not a prediction of anything.
        log.warning('undecodable image received')
        return {'predictions': [], 'modelCard': MODEL_CARD, 'error': 'image_unreadable'}

    logits = session().run(None, {'pixel_values': pixels})[0][0]
    shifted = np.exp(logits - logits.max())
    probabilities = shifted / shifted.sum()
    order = np.argsort(probabilities)[::-1][:5]
    return {
        'predictions': [{
            'displayNames': [_labels[str(int(i))] for i in order],
            'confidences': [float(probabilities[i]) for i in order],
        }],
        'modelCard': MODEL_CARD,
    }


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))

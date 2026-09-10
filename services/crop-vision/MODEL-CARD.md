# Crop vision model

MobileNetV2 fine-tuned for plant disease identification, served on Cloud Run and called by
the platform's vision seam before a photo reaches the language model.

- Weights: `linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification`
- Training data: New Plant Diseases Dataset, derived from PlantVillage
- Classes: 38
- Held-out accuracy: **78.6%** (the 95.4% quoted on the source model card is a different split)
- Runtime: exported to ONNX, 9 MB of weights, CPU inference, scales to zero when idle

## What it is not

**It is not a diagnosis and must never be presented as one.** Two limits decide how its
output may be used, and both travel in every response rather than living only here:

1. **It was trained on laboratory photographs**: a single detached leaf on a plain
   background. A real field photograph with soil, sky, several plants and uneven light is
   outside the distribution it learned. Its confidence in that setting is not trustworthy in
   the way the accuracy figure suggests.
2. **Roughly one prediction in five is wrong** even on the data it was built for, and the 38
   classes do not cover every crop grown in India.

Labels below 35% confidence are dropped by the platform. What survives is passed to the
language model as an observation with its confidence, under instructions that forbid naming a
disease, declaring a deficiency, or recommending a treatment on that basis.

## Access

Private Cloud Run service. Only the platform's own service account may invoke it;
unauthenticated requests are refused with 403.

Replacing this model means replacing the image behind the same endpoint. Nothing in the
platform depends on which model is serving, only on the response shape.

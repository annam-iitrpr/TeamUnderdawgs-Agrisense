# Crop-vision service. ONNX runtime rather than PyTorch keeps the image small
# enough that a scale-to-zero cold start stays in seconds rather than a minute.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY services/crop-vision/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY services/crop-vision/main.py ./
COPY services/crop-vision/model ./model
RUN useradd --system --uid 10001 vision && chown -R vision /app
USER 10001
EXPOSE 8080
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]

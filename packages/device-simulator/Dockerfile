FROM python:3.13-slim

WORKDIR /app

COPY pyproject.toml ./
COPY simulator ./simulator
COPY main.py ./

RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1
ENV CERT_DIR=/certs

CMD ["python", "main.py"]

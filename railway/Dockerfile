FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 HF_HOME=/data/models AUDITOR_DATA_DIR=/data/auditor ANONYMIZED_TELEMETRY=false BROWSER_USE_PYTHON=/opt/browser/bin/python
RUN apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir torchvision --index-url https://download.pytorch.org/whl/cpu
RUN python -m venv /opt/browser && /opt/browser/bin/pip install --no-cache-dir browser-use==0.13.11 "pillow>=11.3,<13"
COPY main.py live_pdp.py cloud_browser.py .
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]

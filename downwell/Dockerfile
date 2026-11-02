FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*
ARG DENO_VERSION=2.9.8
RUN curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" -o /tmp/deno.zip && unzip -q /tmp/deno.zip -d /usr/local/bin && chmod +x /usr/local/bin/deno && rm /tmp/deno.zip && deno --version
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 10000
CMD ["sh", "-c", "exec gunicorn app:app --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 6 --timeout 360 --access-logfile -"]

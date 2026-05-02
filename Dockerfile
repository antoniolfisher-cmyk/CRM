# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend + built frontend ───────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# Install dependencies first (cached unless requirements.txt changes)
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Force cache bust - updated 2026-04-29
ARG CACHEBUST=2026-04-29-v3
RUN echo "Cache bust: $CACHEBUST"

# Copy backend source
COPY backend/ ./

# Copy built React app so FastAPI serves it as static files
COPY --from=frontend-build /frontend/dist ./static

# Create data directory for SQLite volume mount
RUN mkdir -p /data

# Run as non-root user — reduces blast radius of any RCE vulnerability
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app /data
USER appuser

ENV PORT=8000
EXPOSE 8000

# Use auto-detected worker count so all CPU cores are used.
# Set WEB_CONCURRENCY env var to override (e.g. WEB_CONCURRENCY=4 on Railway).
CMD python prestart.py && uvicorn main:app \
    --host 0.0.0.0 \
    --port ${PORT} \
    --workers ${WEB_CONCURRENCY:-2} \
    --timeout-graceful-shutdown 30 \
    --limit-concurrency 1000

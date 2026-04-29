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

# Force cache bust - updated 2026-04-13
ARG CACHEBUST=2026-04-13-v2
RUN echo "Cache bust: $CACHEBUST"

# Copy backend source
COPY backend/ ./

# Copy built React app so FastAPI serves it as static files
COPY --from=frontend-build /frontend/dist ./static

# Create data directory for SQLite volume mount
RUN mkdir -p /data

ENV PORT=8000
# 2 workers fits Railway's default 512 MB container; set WEB_CONCURRENCY=4 if you upgrade RAM
ENV WEB_CONCURRENCY=2
EXPOSE 8000

# prestart.py runs migrations + seed once before workers spawn, then sets PRESTART_DONE
# so each uvicorn worker skips the migration step and starts faster.
CMD PRESTART_DONE=1 python prestart.py && PRESTART_DONE=1 uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY}

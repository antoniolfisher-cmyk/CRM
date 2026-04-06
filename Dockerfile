# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend + built frontend ───────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./

# Copy built React app into backend/static so FastAPI serves it
COPY --from=frontend-build /frontend/dist ./static

# Create data directory for SQLite persistence (Railway volume mounts here)
RUN mkdir -p /data

EXPOSE 8000

CMD ["sh", "-c", "python seed_if_empty.py && uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]

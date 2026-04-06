#!/bin/bash
set -e

echo "=== Wholesale CRM Startup ==="

# Backend setup
echo "Setting up Python backend..."
cd "$(dirname "$0")/backend"

if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r requirements.txt

# Seed database if it doesn't exist
if [ ! -f "crm.db" ]; then
  echo "Seeding database with sample data..."
  python seed.py
fi

# Start backend in background
echo "Starting FastAPI backend on http://localhost:8000 ..."
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Frontend setup
echo "Setting up React frontend..."
cd ../frontend

if [ ! -d "node_modules" ]; then
  npm install
fi

echo "Starting React frontend on http://localhost:3000 ..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "CRM is running:"
echo "  Frontend: http://localhost:3000"
echo "  API:      http://localhost:8000"
echo "  API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped.'" SIGINT SIGTERM
wait

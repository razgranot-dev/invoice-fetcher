#!/usr/bin/env bash
set -e

# ── Invoice Fetcher SaaS — Local Setup ────────────────────────────────
# Run from the repo root:   bash web/setup.sh
# ──────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
WORKER="$ROOT/worker"

echo ""
echo "=== Invoice Fetcher — Local Setup ==="
echo ""

# ── 1. Docker + PostgreSQL ────────────────────────────────────────────

if command -v docker &>/dev/null; then
  echo "[1/7] Docker found. Starting PostgreSQL container..."

  # Remove existing container if stopped
  docker rm -f invoice-fetcher-db 2>/dev/null || true

  docker run -d \
    --name invoice-fetcher-db \
    -e POSTGRES_USER=invoice \
    -e POSTGRES_PASSWORD=invoice_dev_2026 \
    -e POSTGRES_DB=invoice_fetcher \
    -p 5433:5432 \
    postgres:16-alpine

  echo "       Waiting for PostgreSQL to be ready..."
  for i in {1..15}; do
    if docker exec invoice-fetcher-db pg_isready -U invoice &>/dev/null; then
      echo "       PostgreSQL is ready on port 5433."
      break
    fi
    sleep 1
  done
else
  echo "[1/7] WARNING: Docker not found. You need PostgreSQL running on port 5433."
  echo "       Update DATABASE_URL in web/.env if using a different database."
fi

# ── 2. Install web dependencies ───────────────────────────────────────

echo ""
echo "[2/7] Installing web dependencies..."
cd "$WEB"
npm install

# ── 3. Prisma generate + push ────────────────────────────────────────

echo ""
echo "[3/7] Generating Prisma client..."
npx prisma generate

echo ""
echo "[4/7] Pushing schema to database..."
npx prisma db push

# ── 5. Install worker dependencies ───────────────────────────────────

echo ""
echo "[5/7] Installing Python worker dependencies..."
cd "$WORKER"
pip install -r requirements.txt

# ── 6. Start worker in background ────────────────────────────────────

echo ""
echo "[6/7] Starting Python worker on port 8000..."
cd "$ROOT"
python -m uvicorn worker.main:app --port 8000 &
WORKER_PID=$!
echo "       Worker PID: $WORKER_PID"
sleep 2

# ── 7. Start web app ─────────────────────────────────────────────────

echo ""
echo "[7/7] Starting Next.js dev server on port 3000..."
cd "$WEB"
npm run dev &
WEB_PID=$!
echo "       Web PID: $WEB_PID"
sleep 5

# ── Health checks ────────────────────────────────────────────────────

echo ""
echo "=== Health Checks ==="
echo ""

# Worker health
echo -n "Worker (http://localhost:8000/health): "
curl -sf http://localhost:8000/health 2>/dev/null || echo "FAILED (worker may still be starting)"

echo ""

# Web health
echo -n "Web    (http://localhost:3000/api/health): "
curl -sf http://localhost:3000/api/health 2>/dev/null || echo "FAILED (app may still be starting)"

echo ""
echo ""
echo "=== Setup Complete ==="
echo ""
echo "  Web app:  http://localhost:3000"
echo "  Worker:   http://localhost:8000"
echo "  DB:       postgresql://invoice@localhost:5433/invoice_fetcher"
echo ""
echo "  NOTE: Google OAuth credentials are placeholders."
echo "  Login will fail until you set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET"
echo "  in web/.env with real values from Google Cloud Console."
echo ""
echo "  To stop: kill $WEB_PID $WORKER_PID"
echo "           docker stop invoice-fetcher-db"
echo ""

# Keep running
wait

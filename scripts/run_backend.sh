#!/usr/bin/env bash
# Boot the FastAPI backend on port 8000 using backend/venv if it exists.
#
# `npm run dev` at the repo root calls this alongside the Vite dev server, so
# one command brings up the whole app. Run it directly if you only want the API.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
PORT="${API_PORT:-8000}"

cd "$BACKEND_DIR"

# Invoke uvicorn through the interpreter rather than venv/bin/uvicorn: the
# console script hardcodes an absolute shebang, so it breaks the moment the
# project folder is moved or renamed. `python -m` keeps working.
if [ -x "venv/bin/python" ]; then
  exec venv/bin/python -m uvicorn main:app --reload --port "$PORT"
fi

echo "backend/venv not found — falling back to the python on your PATH."
echo "To create it:  cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
exec python -m uvicorn main:app --reload --port "$PORT"

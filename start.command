#!/bin/bash
#
# Stocks Analyzer launcher.
#
# Double-click this file in Finder, or run ./start.command from a terminal.
# It starts one process: the backend serves the API *and* the built frontend,
# so http://127.0.0.1:8080 is the whole app. Press Ctrl-C to stop.

set -euo pipefail

# A double-clicked .command starts in the home directory, not here.
cd "$(dirname "$0")"

ROOT="$(pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV="$BACKEND/venv"
PORT=8080
URL="http://127.0.0.1:$PORT"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
fail() { printf '\033[31mError:\033[0m %s\n' "$1" >&2; }

# Keep the Terminal window readable if we exit early on failure.
die() {
    fail "$1"
    echo
    read -r -p "Press Return to close..." _
    exit 1
}

bold "Stocks Analyzer"
echo

# ── 1. Already running? ───────────────────────────────────────────────────────
if curl -sf --max-time 2 "$URL/api/accounts" >/dev/null 2>&1; then
    info "Already running at $URL — opening it."
    open "$URL"
    exit 0
fi

# Listeners only: a plain "tcp:$PORT" match also catches leftover client
# connections (an open browser tab), which do not actually block the bind.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    die "Port $PORT is in use by another program. Quit it and try again."
fi

# ── 2. Python environment ─────────────────────────────────────────────────────
if [ ! -x "$VENV/bin/python" ]; then
    info "Creating Python environment (first run only)..."
    command -v python3 >/dev/null 2>&1 || die "python3 not found. Install Python 3, then retry."
    python3 -m venv "$VENV" || die "Could not create the virtual environment at $VENV"
fi
PY="$VENV/bin/python"

# Only pay for pip when something is actually missing.
if ! "$PY" -c 'import fastapi, uvicorn, sqlalchemy, httpx, multipart' >/dev/null 2>&1; then
    info "Installing Python dependencies (first run only, may take a minute)..."
    "$PY" -m pip install --quiet --upgrade pip
    "$PY" -m pip install --quiet -r "$BACKEND/requirements.txt" \
        || die "Dependency install failed. Run: $PY -m pip install -r backend/requirements.txt"
fi

# OCR is optional at startup: without an engine the app still runs, you just
# cannot ingest screenshots. Warn rather than block.
if ! "$PY" -c 'import rapidocr_onnxruntime' >/dev/null 2>&1 \
   && ! "$PY" -c 'import easyocr' >/dev/null 2>&1 \
   && ! "$PY" -c 'import pytesseract' >/dev/null 2>&1; then
    info "Note: no OCR engine installed — screenshot import will not work."
    info "      Fix with: $PY -m pip install rapidocr-onnxruntime"
fi

# ── 3. Frontend build ─────────────────────────────────────────────────────────
# dist/ is committed, so this normally does nothing. It rebuilds only if the
# build is missing or a source file is newer than the bundle.
needs_build=0
if [ ! -f "$FRONTEND/dist/index.html" ]; then
    needs_build=1
elif [ -n "$(find "$FRONTEND/src" "$FRONTEND/index.html" -newer "$FRONTEND/dist/index.html" 2>/dev/null | head -1)" ]; then
    needs_build=1
fi

if [ "$needs_build" -eq 1 ]; then
    if command -v npm >/dev/null 2>&1; then
        info "Frontend changed — rebuilding..."
        [ -d "$FRONTEND/node_modules" ] || (cd "$FRONTEND" && npm install --silent)
        (cd "$FRONTEND" && npm run build >/dev/null) \
            || die "Frontend build failed. Run 'npm run build' in frontend/ to see why."
    elif [ ! -f "$FRONTEND/dist/index.html" ]; then
        die "No frontend build and npm is not installed. Install Node.js, then retry."
    else
        info "Frontend sources changed but npm is missing — serving the existing build."
    fi
fi

# ── 4. Start the server ───────────────────────────────────────────────────────
info "Starting server..."
cd "$BACKEND"
"$PY" run_server.py &
SERVER_PID=$!

# Always take the server down with this script.
cleanup() {
    if kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        # Give it a moment to shut down, then insist, so a wedged server can
        # never leave port 8080 occupied for the next run.
        for _ in 1 2 3 4 5; do
            kill -0 "$SERVER_PID" 2>/dev/null || break
            sleep 1
        done
        kill -0 "$SERVER_PID" 2>/dev/null && kill -9 "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    echo
    bold "Stopped."
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 45); do
    if curl -sf --max-time 2 "$URL/api/accounts" >/dev/null 2>&1; then
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        die "The server exited during startup. Scroll up for the traceback."
    fi
    sleep 1
done

if ! curl -sf --max-time 2 "$URL/api/accounts" >/dev/null 2>&1; then
    die "Server did not come up within 45s."
fi

echo
bold "Ready — $URL"
info "Press Ctrl-C to stop."
echo

open "$URL"
wait "$SERVER_PID"

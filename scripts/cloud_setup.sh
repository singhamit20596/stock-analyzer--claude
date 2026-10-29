#!/bin/sh
# One-time setup for publishing the laptop's data to the Netlify website.
#
#   1. Creates the encryption key in ~/.stocks-analyzer/cloud.env (this laptop only).
#   2. Gives the same key to the Netlify site as DATA_KEY.
#   3. Publishes the current data once (encrypted), which triggers a rebuild.
#
# The key is never printed. Run from anywhere; safe to run again (an existing
# key is kept, so earlier published data stays readable).
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
APP="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Stocks Analyzer"
PY="$APP/backend/venv/bin/python"
DB="$APP/backend/portfolio.db"
CONF_DIR="$HOME/.stocks-analyzer"
CONF="$CONF_DIR/cloud.env"

[ -x "$PY" ] || { echo "Can't find the app's Python at $PY"; exit 1; }
[ -f "$DB" ] || { echo "Can't find the database at $DB"; exit 1; }

mkdir -p "$CONF_DIR"
chmod 700 "$CONF_DIR"
umask 077
if grep -q '^CLOUD_DATA_KEY=' "$CONF" 2>/dev/null; then
    echo "1/3  Keeping the existing encryption key."
else
    KEY=$("$PY" -c 'import base64, secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())')
    printf 'CLOUD_DATA_KEY=%s\n' "$KEY" >> "$CONF"
    echo "1/3  Created a new encryption key in $CONF"
fi
chmod 600 "$CONF"
KEY=$(sed -n 's/^CLOUD_DATA_KEY=//p' "$CONF" | head -1)

echo "2/3  Giving the key to the Netlify site..."
cd "$HERE"
./scripts/netlify.sh env:set DATA_KEY "$KEY" --force >/dev/null
unset KEY
echo "     Done."

echo "3/3  Publishing your data (encrypted)..."
cd "$HERE/backend"
PYTHONPATH=. STOCKS_DB_PATH="$DB" "$PY" -c '
from services import cloud_publish as cp
result = cp.publish_now("first publish")
if not result["published"]:
    raise SystemExit("Publish failed: " + result["reason"])
print("     Published", sum(result["row_counts"].values()), "rows.")
'
echo
echo "All set. Netlify is rebuilding now (about a minute). Then this should say \"loaded\":"
echo "  https://stockview2027.netlify.app/api/health"

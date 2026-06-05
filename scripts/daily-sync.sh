#!/usr/bin/env bash
# =====================================================================
# Daily card-data sync — one command for all sources.
#
#   Pokemon EN  -> sync-tcgcsv edge function (21 batches) + refresh views
#   Pokemon JP  -> sync-tcgcsv edge function (14 batches) + refresh views
#   One Piece   -> scripts/crawl-onepiece-tcgcsv.ts
#   Soccer      -> scripts/crawl-soccer-football.ts
#
# Runs locally (reads .env) AND in CI / cron (env from the environment).
# Each step is isolated: one failing source does not stop the others, but
# the script exits non-zero if ANY step failed (so CI flags the run).
#
# Local:  ./scripts/daily-sync.sh
# CI:     same, with secrets exported as env vars.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."   # repo root

# --- resolve SUPABASE_URL / SUPABASE_ANON_KEY for the curl-based pok scripts.
# In CI these come from secrets; locally pull them from .env if not exported.
if [ -f .env ]; then
    ge() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' -e 's/[[:space:]]*$//'; }
    : "${SUPABASE_URL:=$(ge SUPABASE_URL)}";              : "${SUPABASE_URL:=$(ge NEXT_PUBLIC_SUPABASE_URL)}"
    : "${SUPABASE_ANON_KEY:=$(ge SUPABASE_ANON_KEY)}";    : "${SUPABASE_ANON_KEY:=$(ge NEXT_PUBLIC_SUPABASE_ANON_KEY)}"
fi
export SUPABASE_URL SUPABASE_ANON_KEY

# The .ts crawlers (One Piece / Soccer) read their config via `dotenv/config`,
# which needs a .env file. In CI there isn't one, so materialize a temporary
# .env from the environment and remove it on exit. (No-op locally: a real
# .env already exists.)
TMP_ENV=0
if [ ! -f .env ]; then
    {
        printf 'NEXT_PUBLIC_SUPABASE_URL=%s\n'      "${NEXT_PUBLIC_SUPABASE_URL:-$SUPABASE_URL}"
        printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=%s\n' "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$SUPABASE_ANON_KEY}"
        printf 'SUPABASE_URL=%s\n'                  "${SUPABASE_URL}"
        printf 'SUPABASE_ANON_KEY=%s\n'             "${SUPABASE_ANON_KEY}"
        [ -n "${EBAY_APP_ID:-}" ]        && printf 'EBAY_APP_ID=%s\n'        "${EBAY_APP_ID}"
        [ -n "${EBAY_CLIENT_SECRET:-}" ] && printf 'EBAY_CLIENT_SECRET=%s\n' "${EBAY_CLIENT_SECRET}"
    } > .env
    TMP_ENV=1
    trap '[ "${TMP_ENV:-0}" = 1 ] && rm -f .env' EXIT
    echo "[daily-sync] wrote a temporary .env for the ts crawlers (SUPABASE_URL len=${#SUPABASE_URL})"
fi

failures=()
run() {
    local label="$1"; shift
    echo ""
    echo "==================== ${label} — $(date -u '+%Y-%m-%d %H:%M:%SZ') ===================="
    if "$@"; then
        echo ">> ${label}: OK"
    else
        echo ">> ${label}: FAILED (continuing)"
        failures+=("${label}")
    fi
}

# Pokémon EN+JP via a LOCAL direct-TCGCSV crawler (the sync-tcgcsv edge
# function is blocked: it runs on Supabase's cloud IP → TCGCSV 401).
run "Pokemon (EN+JP)" npx --yes tsx scripts/crawl-pokemon-tcgcsv.ts
run "One Piece"       npx --yes tsx scripts/crawl-onepiece-tcgcsv.ts
run "Soccer"          npx --yes tsx scripts/crawl-soccer-football.ts

echo ""
echo "==================== SUMMARY — $(date -u '+%Y-%m-%d %H:%M:%SZ') ===================="
if [ ${#failures[@]} -eq 0 ]; then
    echo "All syncs completed successfully."
    exit 0
fi
echo "Failed steps: ${failures[*]}"
exit 1

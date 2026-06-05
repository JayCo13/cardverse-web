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

run "Pokemon EN" bash scripts/crawl-pok-en.sh
run "Pokemon JP" bash scripts/crawl-pok-jp.sh
run "One Piece"  npx --yes tsx scripts/crawl-onepiece-tcgcsv.ts
run "Soccer"     npx --yes tsx scripts/crawl-soccer-football.ts

echo ""
echo "==================== SUMMARY — $(date -u '+%Y-%m-%d %H:%M:%SZ') ===================="
if [ ${#failures[@]} -eq 0 ]; then
    echo "All syncs completed successfully."
    exit 0
fi
echo "Failed steps: ${failures[*]}"
exit 1

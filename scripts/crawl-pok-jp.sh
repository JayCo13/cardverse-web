#!/bin/bash
# Sync Japanese Pokemon cards (category_id=85) - runs 14 batches
# Requires: SUPABASE_URL and SUPABASE_ANON_KEY environment variables

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "Error: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required"
  echo "Set them in your .env file or export them before running this script"
  exit 1
fi

echo "Starting Japanese Pokemon sync at $(date)"

for i in {0..13}; do
  echo "Syncing Japanese batch $i..."
  curl -X POST "${SUPABASE_URL}/functions/v1/sync-tcgcsv?category_id=85&batch=$i" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}"
  echo ""
  sleep 5
done

echo "Japanese Pokemon sync completed at $(date)"

# Refresh materialized views via RPC
echo "Refreshing materialized views..."
curl -X POST "${SUPABASE_URL}/rest/v1/rpc/refresh_pokemon_views" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json"
echo ""
echo "Done at $(date)"

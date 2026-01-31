#!/bin/bash
# Sync English Pokemon cards (category_id=3) - runs 21 batches
# Requires: SUPABASE_URL and SUPABASE_ANON_KEY environment variables

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "Error: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required"
  echo "Set them in your .env file or export them before running this script"
  exit 1
fi

echo "Starting English Pokemon sync at $(date)"

for i in {0..20}; do
  echo "Syncing English batch $i..."
  curl -X POST "${SUPABASE_URL}/functions/v1/sync-tcgcsv?category_id=3&batch=$i" \
    -H "Authorization: Bearer ${SUPABASE_ANON_KEY}"
  echo ""
  sleep 5
done

echo "English Pokemon sync completed at $(date)"

# Refresh materialized views via RPC
echo "Refreshing materialized views..."
curl -X POST "${SUPABASE_URL}/rest/v1/rpc/refresh_pokemon_views" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json"
echo ""
echo "Done at $(date)"

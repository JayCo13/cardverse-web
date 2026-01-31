#!/bin/bash
# Refresh Pokemon materialized views after sync
# This should run after the sync scripts complete

echo "Refreshing Pokemon materialized views at $(date)"

# Use psql to connect and refresh views
PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql -h db.gvllbgiotawavgcemfkq.supabase.co -U postgres -d postgres -c "
REFRESH MATERIALIZED VIEW pokemon_sets_en;
REFRESH MATERIALIZED VIEW pokemon_sets_jp;
REFRESH MATERIALIZED VIEW featured_pokemon_cards;
"

echo "Materialized views refreshed at $(date)"

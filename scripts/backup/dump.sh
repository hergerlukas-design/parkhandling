#!/usr/bin/env bash
# Sichert die Supabase-Datenbank nach dem offiziellen Verfahren (supabase db dump):
# roles.sql, schema.sql, data.sql plus counts.txt (Zeilenzahlen zum Prüfen der Wiederherstellung).
# Dateien im Storage (Fotos, PDFs) sind NICHT enthalten, nur ihre Verweise in public.media.
#
#   scripts/backup/dump.sh "$SUPABASE_DB_URL" backup/
#
# SUPABASE_DB_URL: Dashboard → Connect → Session pooler (Port 5432), Passwort percent-encoded.
# Voraussetzung: Docker (die CLI führt pg_dump im Container aus) und psql.
set -euo pipefail

DB_URL="${1:?Verbindungs-URL fehlt}"
OUT="${2:?Zielordner fehlt}"
SUPABASE=(npx --yes supabase@2)
mkdir -p "$OUT"

"${SUPABASE[@]}" db dump --db-url "$DB_URL" --role-only -f "$OUT/roles.sql"
"${SUPABASE[@]}" db dump --db-url "$DB_URL" -f "$OUT/schema.sql"
# Interne, leere Storage-Tabellen für Vektor-Buckets darf postgres in einem neuen Projekt nicht befüllen
"${SUPABASE[@]}" db dump --db-url "$DB_URL" --data-only --use-copy \
  -x storage.buckets_vectors -x storage.vector_indexes -f "$OUT/data.sql"

psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -f "$(dirname "$0")/counts.sql" > "$OUT/counts.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$OUT/created_at.txt"

for f in roles.sql schema.sql data.sql; do
  [ -s "$OUT/$f" ] || { echo "::error::$f ist leer"; exit 1; }
done
echo "✓ Sicherung in $OUT:"
cat "$OUT/counts.txt"

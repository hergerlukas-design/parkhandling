#!/usr/bin/env bash
# Spielt alle Migrationen + Seed in eine frische lokale Postgres-Datenbank ein und
# führt die SQL-Tests in supabase/tests/*.test.sql aus.
# Voraussetzung: lokaler Postgres (psql) mit Superuser-Zugang, z. B. PGUSER=postgres.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${PF_TEST_DB:-parkhandling_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 --no-psqlrc)

"${PSQL[@]}" -d postgres -c "drop database if exists ${DB}" -c "create database ${DB}"
"${PSQL[@]}" -d "$DB" -f supabase/tests/supabase_stub.sql

for f in supabase/migrations/*.sql; do
  echo "→ Migration ${f##*/}"
  "${PSQL[@]}" -d "$DB" -f "$f"
done

echo "→ Seed"
"${PSQL[@]}" -d "$DB" -f supabase/seed.sql

status=0
for t in supabase/tests/*.test.sql; do
  [ -e "$t" ] || continue
  echo "→ Test ${t##*/}"
  if ! "${PSQL[@]}" -d "$DB" -f "$t"; then
    status=1
  fi
done

[ "${KEEP_DB:-0}" = "1" ] || "${PSQL[@]}" -d postgres -c "drop database ${DB}"
if [ $status -eq 0 ]; then echo "✓ Alle Datenbank-Tests bestanden"; else echo "✗ Datenbank-Tests fehlgeschlagen"; fi
exit $status

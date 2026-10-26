#!/usr/bin/env bash
# Prüft vor dem Deploy, ob jede Migration aus supabase/migrations/ in der Datenbank eingespielt ist.
# Abgleich über den Namen (Teil nach dem Zeitstempel): Über den SQL-Editor bzw. MCP eingespielte
# Migrationen bekommen in supabase_migrations.schema_migrations einen eigenen Zeitstempel.
# Aufruf: DATABASE_URL=postgresql://… ./scripts/check-migrations.sh
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL fehlt}"

applied="$(psql "$DATABASE_URL" -X -A -t --no-psqlrc -v ON_ERROR_STOP=1 \
  -c "select name from supabase_migrations.schema_migrations")"

missing=0
for f in supabase/migrations/*.sql; do
  file="${f##*/}"
  name="${file%.sql}"
  name="${name#*_}"
  if ! grep -qxF "$name" <<<"$applied"; then
    echo "::error::Migration fehlt in der Datenbank: ${file}"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "Migrationen zuerst einspielen (supabase db push oder SQL-Editor), dann den Deploy neu starten."
  exit 1
fi
echo "Alle $(ls supabase/migrations/*.sql | wc -l) Migrationen sind eingespielt."

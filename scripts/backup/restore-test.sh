#!/usr/bin/env bash
# Wiederherstellungstest: spielt eine Sicherung (dump.sh) in eine frische, lokale Supabase-Datenbank
# ein und vergleicht die Zeilenzahlen mit counts.txt. Die Produktion wird dabei nicht berührt.
#
#   scripts/backup/restore-test.sh backup/
#
# Voraussetzung: Docker, psql. Dauert beim ersten Mal einige Minuten (Image-Download).
set -euo pipefail

DIR="$(cd "${1:?Ordner der Sicherung fehlt}" && pwd)"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPABASE=(npx --yes supabase@2)
WORK="$(mktemp -d)"
trap '(cd "$WORK" && "${SUPABASE[@]}" stop --no-backup >/dev/null 2>&1) || true; rm -rf "$WORK"' EXIT

# Leeres Supabase-Projekt (ohne unsere Migrationen) – das Schema kommt aus der Sicherung
cd "$WORK"
"${SUPABASE[@]}" init --force >/dev/null
# Eigene Ports, damit ein laufendes lokales Supabase nicht stört
sed -i 's/^port = 54322/port = 55322/; s/^project_id = .*/project_id = "pf-restore-test"/' supabase/config.toml
"${SUPABASE[@]}" db start

TARGET="postgresql://postgres:postgres@127.0.0.1:55322/postgres"

# Wie in der Supabase-Anleitung „Restore to a new project“. roles.sql enthält nur Einstellungen der von
# Supabase verwalteten Rollen; einzelne Zeilen (z. B. GRANT SET ON PARAMETER) darf der Nutzer postgres
# in einem neuen Projekt nicht ausführen – diese Fehler sind harmlos und werden nur angezeigt.
psql "$TARGET" -X -q -v ON_ERROR_STOP=0 --file "$DIR/roles.sql" || true
psql "$TARGET" -X -q -o /dev/null --single-transaction -v ON_ERROR_STOP=1 \
  --file "$DIR/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$DIR/data.sql"

psql "$TARGET" -X -At -v ON_ERROR_STOP=1 -f "$HERE/counts.sql" > "$WORK/restored_counts.txt"

if diff -u "$DIR/counts.txt" "$WORK/restored_counts.txt"; then
  echo "✓ Wiederherstellung vollständig ($(cat "$DIR/created_at.txt" 2>/dev/null || echo 'Zeitpunkt unbekannt')):"
  cat "$WORK/restored_counts.txt"
else
  echo "::error::Zeilenzahlen nach der Wiederherstellung weichen ab"
  exit 1
fi

# Stichprobe: App-Funktionen sind lauffähig
psql "$TARGET" -X -At -v ON_ERROR_STOP=1 -c "select count(*) from public.booking_list" >/dev/null
echo "✓ View booking_list abfragbar"

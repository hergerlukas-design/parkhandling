# Notfall-Anleitung: Wiederherstellen und Zurückrollen

Stand: 20.10.2026 · Gilt für Supabase-Projekt `parkhandling` (Free-Plan) und Fly-App `parkhandling`.

| Was ist passiert? | Abschnitt |
|---|---|
| Neue App-Version ist fehlerhaft | [1. App-Version zurückrollen](#1-app-version-zurückrollen) |
| Daten versehentlich geändert/gelöscht, Datenbank defekt oder Projekt weg | [2. Datenbank wiederherstellen](#2-datenbank-wiederherstellen) |
| Fotos/PDFs fehlen | [3. Dateien im Storage](#3-dateien-im-storage) |

## 1. App-Version zurückrollen

Die App ist ein statisches Frontend; ein Rollback ändert keine Daten.

```bash
fly releases -a parkhandling --image          # Liste mit Image je Version
fly deploy -a parkhandling --image registry.fly.io/parkhandling:deployment-<ID>   # gewünschte ältere Version
```

Alternativ auf GitHub den letzten guten Commit auf `main` per *Revert* zurücknehmen; der Deploy-Workflow
liefert ihn automatisch aus. Geräte bekommen das Update-Banner wie bei jeder neuen Version.

**Achtung:** Hat die fehlerhafte Version eine Datenbank-Migration mitgebracht, passt die alte App
eventuell nicht mehr zum Schema. Migrationen sind bisher immer abwärtskompatibel (nur Ergänzungen) –
das ist Pflicht, damit dieser Rollback funktioniert.

## 2. Datenbank wiederherstellen

Der Free-Plan hat **keine** Backups im Dashboard. Gesichert wird jede Nacht über GitHub Actions
(`.github/workflows/backup.yml`), 30 Tage aufbewahrt, verschlüsselt mit `BACKUP_PASSPHRASE`.
Sonntags spielt der Workflow die Sicherung probeweise ein (Wiederherstellungstest).

### 2.1 Sicherung holen und entschlüsseln

1. GitHub → *Actions → Datenbank-Backup* → gewünschten Lauf öffnen → Artefakt `db-backup-…` laden
2. Entpacken (zip) und entschlüsseln:

```bash
gpg -o backup.tar.gz -d backup.tar.gz.gpg      # fragt nach BACKUP_PASSPHRASE
mkdir backup && tar -xzf backup.tar.gz -C backup
cat backup/created_at.txt backup/counts.txt    # Zeitpunkt und Zeilenzahlen prüfen
```

Optional vorher prüfen, ob sich die Sicherung einspielen lässt (Docker nötig, berührt nichts):
`./scripts/backup/restore-test.sh backup`

### 2.2 Einspielen

**Neues Projekt (empfohlen, wenn das alte defekt oder gelöscht ist):** Im Dashboard ein neues Projekt
in der EU anlegen, Connect → Session-pooler-URI kopieren, dann:

```bash
psql "$NEUE_DB_URL" -v ON_ERROR_STOP=0 -f backup/roles.sql      # einzelne Rechte-Fehler sind harmlos
psql "$NEUE_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
  -f backup/schema.sql -c 'SET session_replication_role = replica' -f backup/data.sql
```

Danach:

1. Edge Functions deployen: `media-sign`, `protocol-mail`, `user-invite`, `media-retention`
   (`media-retention` mit `--no-verify-jwt`), Secrets `RESEND_API_KEY`/`MAIL_FROM` neu setzen
2. Vault-Secrets neu anlegen (die gesicherten sind mit dem Schlüssel des alten Projekts verschlüsselt):
   ```sql
   delete from vault.secrets where name in ('project_url', 'media_retention_cron_secret');
   select vault.create_secret('https://<neue-ref>.supabase.co', 'project_url');
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'media_retention_cron_secret');
   ```
3. `.env` mit neuer `VITE_SUPABASE_URL` und neuem Publishable Key committen → Deploy läuft automatisch
4. Secret `SUPABASE_DB_URL` auf GitHub auf das neue Projekt umstellen
5. Alle Mitarbeiter melden sich neu an (Passwörter sind mitgesichert)

**Bestehendes Projekt (einzelne Daten zurückholen):** Nicht das ganze Projekt überschreiben. Die
Sicherung in eine lokale Datenbank einspielen (in einem leeren Ordner `npx supabase init` und
`npx supabase db start`, dann die Befehle oben gegen `postgresql://postgres:postgres@127.0.0.1:54322/postgres`),
die betroffenen Zeilen dort heraussuchen und gezielt per SQL in die Produktion zurückschreiben.

## 3. Dateien im Storage

Fotos, Unterschriften und PDF-Protokolle liegen im Supabase Storage und sind **nicht** in der
Datenbank-Sicherung enthalten (nur ihre Verweise in `public.media`). Der Storage ist redundant
gespeichert; verloren gehen Dateien nur durch Löschen. Gelöscht wird ausschließlich:

- durch den Aufbewahrungs-Job (nur Vollbild-Fotos nach Fristablauf, protokolliert in
  `media_retention_runs`, siehe Einstellungen → Aufbewahrung)
- durch Admins direkt im Dashboard

## 4. Wiederherstellung üben

Mindestens einmal pro Quartal: *Actions → Datenbank-Backup → Run workflow* mit „Wiederherstellungstest“
und das Ergebnis (grün, Zeilenzahlen) kurz prüfen. Der Test läuft zusätzlich jeden Sonntag automatisch.

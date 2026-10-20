-- Zusammenfassung der letzten 24 Stunden für .github/workflows/error-report.yml.
-- Das Repository ist öffentlich: nur Anzahlen, keine Meldungstexte, Ansichten oder Personen.
-- Details stehen nur in der App (Einstellungen → Fehlerprotokoll, nur Admins).
-- Zeilen mit „| “ am Anfang zählt der Workflow, um zu entscheiden, ob ein Issue nötig ist.
with errors as (
  select count(*) as distinct_errors, coalesce(sum(occurrences), 0) as total,
         count(distinct user_id) as users, string_agg(distinct app_version, ', ') as versions
    from public.client_errors
   where last_seen_at > now() - interval '24 hours'
), runs as (
  select count(*) as failed_runs
    from public.media_retention_runs
   where started_at > now() - interval '24 hours' and (error is not null or failed_count > 0)
)
select '|Bereich|Ergebnis|'
  where (select distinct_errors from errors) > 0 or (select failed_runs from runs) > 0
union all select '|---|---|'
  where (select distinct_errors from errors) > 0 or (select failed_runs from runs) > 0
union all select format('| Fehler aus der App | %s Meldungen (%s verschiedene) von %s Nutzern, Version %s |',
                        total, distinct_errors, users, coalesce(versions, '?'))
  from errors where distinct_errors > 0
union all select format('| Foto-Lösch-Job | %s Lauf/Läufe mit Fehlern |', failed_runs)
  from runs where failed_runs > 0;

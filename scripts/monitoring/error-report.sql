-- Markdown-Zusammenfassung der letzten 24 Stunden für .github/workflows/error-report.yml.
-- Tabellenzeilen beginnen mit „| “; der Workflow zählt sie, um zu entscheiden, ob ein Issue nötig ist.
-- Keine Personen- oder Kundendaten: nur Meldung, Ort, Version und Anzahl.
with errors as (
  select kind, message, route, app_version,
         sum(occurrences) as total, count(distinct user_id) as users, max(last_seen_at) as last_seen
    from public.client_errors
   where last_seen_at > now() - interval '24 hours'
   group by kind, message, route, app_version
), runs as (
  select started_at, trigger, deleted_count, failed_count, error
    from public.media_retention_runs
   where started_at > now() - interval '24 hours' and (error is not null or failed_count > 0)
)
select '### Fehler aus der App' where exists (select 1 from errors)
union all select '' where exists (select 1 from errors)
union all select '|Anzahl|Geräte/Nutzer|Meldung|Ansicht|Version|zuletzt (UTC)|' where exists (select 1 from errors)
union all select '|---|---|---|---|---|---|' where exists (select 1 from errors)
union all (
  select format('| %s | %s | %s | %s | %s | %s |', total, users,
                replace(left(message, 160), '|', '/'), coalesce(route, '–'), coalesce(app_version, '?'),
                to_char(last_seen at time zone 'UTC', 'DD.MM. HH24:MI'))
    from errors order by total desc limit 30
)
union all select '' where exists (select 1 from runs)
union all select '### Foto-Lösch-Job mit Fehlern' where exists (select 1 from runs)
union all select '' where exists (select 1 from runs)
union all select '|Start (UTC)|Auslöser|Ergebnis|Fehler|' where exists (select 1 from runs)
union all select '|---|---|---|---|' where exists (select 1 from runs)
union all (
  select format('| %s | %s | %s gelöscht, %s fehlgeschlagen | %s |',
                to_char(started_at at time zone 'UTC', 'DD.MM. HH24:MI'), trigger, deleted_count, failed_count,
                replace(coalesce(left(error, 200), '–'), '|', '/'))
    from runs order by started_at
);

-- =============================================================================
-- 0.30.0 Laden: geladene kWh beim Abschließen der Aufgabe „Laden“
--
-- Ersetzt die Ladepunkt-/Kempower-Anbindung aus 0.29.0 (deren Migration wurde nie angewendet
-- und ist entfernt). Das Personal trägt beim „Erledigt“ einer Ladeaufgabe die geladene
-- Energie vom Display der Säule ein.
--
-- Rein additiv: alte App-Versionen arbeiten unverändert weiter (Abschnitt 6, Punkt 7).
-- Die View task_board bleibt unverändert (t.* wurde beim Anlegen aufgelöst); die App liest
-- energy_kwh direkt aus tasks.
-- =============================================================================

alter table public.tasks
  add column if not exists energy_kwh numeric(10, 3);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_energy_kwh_check') then
    alter table public.tasks
      add constraint tasks_energy_kwh_check
      check (energy_kwh is null or (energy_kwh >= 0 and energy_kwh <= 500));
  end if;
end;
$$;

comment on column public.tasks.energy_kwh is
  'Geladene Energie in kWh (nur Aufgaben type = charge), beim Abschließen eingetragen';

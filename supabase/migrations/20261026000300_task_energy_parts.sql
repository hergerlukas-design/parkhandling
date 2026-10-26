-- =============================================================================
-- 0.30.0 Laden: mehrere Ladevorgänge je Aufgabe
--
-- Bricht eine Ladung ab und wird neu angesteckt, beginnt die Säule wieder bei 0 kWh.
-- Jeder Ladevorgang wird deshalb einzeln erfasst; tasks.energy_kwh bleibt die Summe.
--   energy_parts: [{"kwh": 3.1, "at": "2026-10-26T11:20:00Z"}, …]
--
-- Rein additiv.
-- =============================================================================

alter table public.tasks
  add column if not exists energy_parts jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_energy_parts_check') then
    alter table public.tasks
      add constraint tasks_energy_parts_check
      check (jsonb_typeof(energy_parts) = 'array' and jsonb_array_length(energy_parts) <= 20);
  end if;
end;
$$;

comment on column public.tasks.energy_parts is
  'Einzelne Ladevorgänge einer Ladeaufgabe [{kwh, at}]; energy_kwh ist die Summe';

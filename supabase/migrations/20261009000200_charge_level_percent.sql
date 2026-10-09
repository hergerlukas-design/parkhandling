-- Version 0.16.0: Ladestand als Prozentwert 1–100 (Textfeld) statt 8 Segmente.
-- Die Spalte ist seit 20261009000100 leer (App noch nicht ausgeliefert), daher keine Umrechnung.
alter table public.protocols drop constraint if exists protocols_charge_level_check;
alter table public.protocols
  add constraint protocols_charge_level_check check (charge_level between 1 and 100);

comment on column public.protocols.charge_level is 'Ladestand in Prozent (1–100), Elektro und Hybrid';

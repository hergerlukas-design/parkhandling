-- =============================================================================
-- Protokolle Annahme/Übergabe (Abschnitt 9) – Felder für das PDF-Layout aus
-- fahrzeug-protokolle-v2 (pdf-template), Foto-Slots, Schutz finaler Protokolle.
-- Additiv und abwärtskompatibel zu 0.8.0.
-- =============================================================================

alter table public.protocols
  add column if not exists status text not null default 'draft' check (status in ('draft', 'final')),
  add column if not exists inspector_name text,
  add column if not exists location_text text,
  add column if not exists vin text,
  add column if not exists conditions text[] not null default '{}',
  add column if not exists checklist jsonb not null default '{}'::jsonb,
  add column if not exists customer_signer_name text,
  add column if not exists customer_signature_media_id uuid references public.media (id) on delete set null,
  add column if not exists finalized_at timestamptz,
  add column if not exists mail_status text check (mail_status in ('sent', 'not_configured', 'failed', 'disabled')),
  add column if not exists mail_error text;

comment on column public.protocols.signature_media_id is 'Unterschrift Mitarbeiter (Ersteller)';
comment on column public.protocols.customer_signature_media_id is 'Unterschrift Kunde';

-- Je Buchung höchstens ein Annahme- und ein Übergabeprotokoll (Entwurf wird final)
create unique index if not exists protocols_booking_type_uidx on public.protocols (booking_id, type);
create index if not exists protocols_customer_signature_idx on public.protocols (customer_signature_media_id);

-- Foto-Slot je Datei: vorne, hinten, links, rechts, schein, signature, signature_customer,
-- schaden_<n>, zusatz_<n>, pdf
alter table public.media add column if not exists slot text;
create index if not exists media_owner_slot_idx on public.media (owner_type, owner_id, slot);

-- Finale Protokolle sind unveränderlich (nur PDF-Verweis und Versandstatus dürfen nachgetragen werden)
create or replace function public.protect_final_protocol()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'final' then
    if (to_jsonb(new) - array['pdf_media_id', 'sent_at', 'mail_status', 'mail_error',
                              'signature_media_id', 'customer_signature_media_id', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['pdf_media_id', 'sent_at', 'mail_status', 'mail_error',
                              'signature_media_id', 'customer_signature_media_id', 'updated_at']) then
      raise exception 'Protokoll ist abgeschlossen und kann nicht mehr geändert werden' using errcode = 'P0001';
    end if;
  end if;
  if new.status = 'final' and old.status = 'draft' then
    new.finalized_at := coalesce(new.finalized_at, now());
    if new.mileage is null then
      raise exception 'Kilometerstand fehlt' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger protocols_protect_final
  before update on public.protocols
  for each row execute function public.protect_final_protocol();

revoke execute on function public.protect_final_protocol() from public, anon, authenticated;

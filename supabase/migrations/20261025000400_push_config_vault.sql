-- =============================================================================
-- 0.26.2 Push-Konfiguration aus dem Supabase Vault
--
-- Die Edge Function push-send braucht keine eigenen Secrets mehr: privater VAPID-Schlüssel
-- und Aufruf-Secret liegen im Vault (push_vapid_private_key, push_send_secret), der öffentliche
-- Schlüssel in settings.push_vapid_public_key. Die Function liest alles mit ihrem Service-Zugang
-- über push_send_config(). Gesetzte Function-Secrets (VAPID_*, PUSH_SEND_SECRET) haben weiter Vorrang.
--
-- Rein additiv.
-- =============================================================================

insert into public.settings (key, value, description) values
  ('push_vapid_subject', '"https://parkhandling.fly.dev"',
   'Kontakt für die Push-Dienste (VAPID sub): https-URL der App oder mailto:-Adresse')
on conflict (key) do nothing;

create or replace function public.push_send_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_private text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_private_key'$q$ into v_private;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'push_send_secret'$q$ into v_secret;
  end if;
  return jsonb_build_object(
    'public_key', coalesce(public.get_setting('push_vapid_public_key') #>> '{}', ''),
    'private_key', coalesce(v_private, ''),
    'subject', coalesce(public.get_setting('push_vapid_subject') #>> '{}', 'https://parkhandling.fly.dev'),
    'secret', coalesce(v_secret, '')
  );
end;
$$;

revoke execute on function public.push_send_config() from public, anon, authenticated;
grant execute on function public.push_send_config() to service_role;

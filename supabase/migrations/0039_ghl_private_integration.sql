-- 0039 — per-user HighLevel Private Integration Token storage

create or replace function public.save_ghl_connection(
  p_user_id uuid,
  p_encrypted_payload text,
  p_location_id text,
  p_location_name text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_connection_id uuid;
  v_secret_reference uuid;
begin
  insert into public.integration_connections (
    user_id, provider, status, external_account_id, external_account_name,
    scopes, connected_at, last_tested_at, last_error
  ) values (
    p_user_id, 'ghl', 'connected', p_location_id, p_location_name,
    array['contacts.write','contacts.readonly','locations.readonly'], now(), now(), null
  )
  on conflict (user_id, provider) do update
    set status = 'connected',
        external_account_id = excluded.external_account_id,
        external_account_name = excluded.external_account_name,
        scopes = excluded.scopes,
        connected_at = now(),
        last_tested_at = now(),
        last_error = null
  returning id, secret_reference into v_connection_id, v_secret_reference;

  insert into public.integration_secrets (id, connection_id, encrypted_payload)
  values (v_secret_reference, v_connection_id, p_encrypted_payload)
  on conflict (connection_id) do update set encrypted_payload = excluded.encrypted_payload;
  return v_connection_id;
end;
$$;

revoke all on function public.save_ghl_connection(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_ghl_connection(uuid, text, text, text) to service_role;

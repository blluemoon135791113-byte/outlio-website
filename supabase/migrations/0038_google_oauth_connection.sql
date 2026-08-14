-- 0038 — atomic Google OAuth credential persistence and token refresh

create or replace function public.save_google_connection(
  p_user_id uuid,
  p_encrypted_payload text,
  p_external_account_id text,
  p_external_account_name text,
  p_external_account_email text,
  p_scopes text[],
  p_token_expires_at timestamptz
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
    external_account_email, scopes, token_expires_at, connected_at,
    last_tested_at, last_error
  ) values (
    p_user_id, 'google', 'connected', p_external_account_id,
    p_external_account_name, p_external_account_email, coalesce(p_scopes, '{}'),
    p_token_expires_at, now(), now(), null
  )
  on conflict (user_id, provider) do update
    set status = 'connected',
        external_account_id = excluded.external_account_id,
        external_account_name = excluded.external_account_name,
        external_account_email = excluded.external_account_email,
        scopes = excluded.scopes,
        token_expires_at = excluded.token_expires_at,
        connected_at = now(),
        last_tested_at = now(),
        last_error = null
  returning id, secret_reference into v_connection_id, v_secret_reference;

  insert into public.integration_secrets (id, connection_id, encrypted_payload)
  values (v_secret_reference, v_connection_id, p_encrypted_payload)
  on conflict (connection_id) do update
    set encrypted_payload = excluded.encrypted_payload;

  return v_connection_id;
end;
$$;

create or replace function public.update_google_tokens(
  p_user_id uuid,
  p_connection_id uuid,
  p_expected_encrypted_payload text,
  p_encrypted_payload text,
  p_scopes text[],
  p_token_expires_at timestamptz
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  update public.integration_secrets as secret
     set encrypted_payload = p_encrypted_payload
   where secret.connection_id = p_connection_id
     and secret.encrypted_payload = p_expected_encrypted_payload
     and exists (
       select 1 from public.integration_connections as connection
        where connection.id = p_connection_id
          and connection.user_id = p_user_id
          and connection.provider = 'google'
          and connection.status = 'connected'
     )
  returning secret.connection_id into v_updated_id;

  if v_updated_id is null then return false; end if;

  update public.integration_connections
     set token_expires_at = p_token_expires_at,
         scopes = coalesce(p_scopes, integration_connections.scopes),
         last_used_at = now(),
         last_error = null
   where id = p_connection_id and user_id = p_user_id and provider = 'google';
  return true;
end;
$$;

revoke all on function public.save_google_connection(uuid, text, text, text, text, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.save_google_connection(uuid, text, text, text, text, text[], timestamptz) to service_role;
revoke all on function public.update_google_tokens(uuid, uuid, text, text, text[], timestamptz) from public, anon, authenticated;
grant execute on function public.update_google_tokens(uuid, uuid, text, text, text[], timestamptz) to service_role;

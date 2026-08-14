-- 0037 — serialize Salesforce single-use refresh-token rotation
--
-- A short database lease prevents separate serverless instances from
-- redeeming the same rotating refresh token concurrently.

drop function if exists public.update_salesforce_tokens(
  uuid, uuid, text, text, text[], timestamptz
);

create or replace function public.update_salesforce_tokens(
  p_user_id uuid,
  p_connection_id uuid,
  p_expected_encrypted_payload text,
  p_encrypted_payload text,
  p_refresh_claim text,
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
       select 1
         from public.integration_connections as connection
        where connection.id = p_connection_id
          and connection.user_id = p_user_id
          and connection.provider = 'salesforce'
          and connection.status = 'connected'
          and connection.configuration->>'refresh_claim' = p_refresh_claim
     )
  returning secret.connection_id into v_updated_id;

  if v_updated_id is null then
    return false;
  end if;

  update public.integration_connections
     set token_expires_at = p_token_expires_at,
         scopes = coalesce(p_scopes, integration_connections.scopes),
         configuration = '{}'::jsonb,
         last_used_at = now(),
         last_error = null
   where id = p_connection_id
     and user_id = p_user_id
     and provider = 'salesforce';

  return true;
end;
$$;

create or replace function public.claim_salesforce_token_refresh(
  p_user_id uuid,
  p_connection_id uuid,
  p_expected_encrypted_payload text,
  p_refresh_claim text,
  p_claim_expires_at timestamptz
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  update public.integration_connections as connection
     set configuration = jsonb_build_object(
       'refresh_claim', p_refresh_claim,
       'refresh_claim_expires_at', p_claim_expires_at
     )
   where connection.id = p_connection_id
     and connection.user_id = p_user_id
     and connection.provider = 'salesforce'
     and connection.status = 'connected'
     and exists (
       select 1
         from public.integration_secrets as secret
        where secret.connection_id = p_connection_id
          and secret.encrypted_payload = p_expected_encrypted_payload
     )
     and (
       connection.configuration->>'refresh_claim_expires_at' is null
       or (connection.configuration->>'refresh_claim_expires_at')::timestamptz <= now()
     )
  returning connection.id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

create or replace function public.release_salesforce_token_refresh(
  p_user_id uuid,
  p_connection_id uuid,
  p_refresh_claim text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  update public.integration_connections
     set configuration = '{}'::jsonb
   where id = p_connection_id
     and user_id = p_user_id
     and provider = 'salesforce'
     and configuration->>'refresh_claim' = p_refresh_claim
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

revoke all on function public.update_salesforce_tokens(
  uuid, uuid, text, text, text, text[], timestamptz
) from public, anon, authenticated;
grant execute on function public.update_salesforce_tokens(
  uuid, uuid, text, text, text, text[], timestamptz
) to service_role;

revoke all on function public.claim_salesforce_token_refresh(
  uuid, uuid, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_salesforce_token_refresh(
  uuid, uuid, text, text, timestamptz
) to service_role;

revoke all on function public.release_salesforce_token_refresh(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.release_salesforce_token_refresh(
  uuid, uuid, text
) to service_role;

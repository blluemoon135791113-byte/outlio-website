-- 0023: remove inherited PUBLIC execution from internal SECURITY DEFINER
-- functions and pin mutable search paths reported by Supabase Security Advisor.

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.deny_mutation() set search_path = public, pg_temp;

revoke all on function public.consume_rate_limit(text, text, timestamptz, int, int)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, timestamptz, int, int)
  to service_role;

revoke all on function public.sweep_rate_limits()
  from public, anon, authenticated;
grant execute on function public.sweep_rate_limits()
  to service_role;

-- Trigger functions are invoked by their owning triggers, never by API roles.
revoke all on function public.handle_new_user()
  from public, anon, authenticated;
revoke all on function public.prevent_duplicate_signup_identity()
  from public, anon, authenticated;
revoke all on function public.protect_profile_columns()
  from public, anon, authenticated;

-- RLS policies call is_admin() for signed-in users. Anonymous callers do not
-- need it, and service-role access remains explicit.
revoke all on function public.is_admin()
  from public, anon, authenticated;
grant execute on function public.is_admin()
  to authenticated, service_role;

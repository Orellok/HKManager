-- M7.3-12(d) (M7.2 carry): configure_push_reminders() stores the URL that pg_cron POSTs the
-- reminders secret to, so only this project's own Supabase function URL is accepted:
-- https://<20-letter project ref>.supabase.co/functions/v1/push, or the local stack's hosts.
-- Any other https host (which the M7.2 rule allowed) is refused.
--
-- M7.3-12(c): the `net` grants to anon / authenticated are made by supabase_admin when pg_net
-- is installed; the migration role (postgres) is neither their grantor nor a superuser, so a
-- REVOKE here is a no-op. Neither role can reach `net`: the Data API exposes only `public`
-- and `graphql_public` (supabase/config.toml), and every function that calls pg_net is
-- closed to them (tests/integration/pg-net-access.test.ts proves both).
create or replace function public.configure_push_reminders(p_function_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
begin
  if p_function_url is null or not (
    p_function_url ~ '^https://[a-z]{20}\.supabase\.co/functions/v1/push$'
    or p_function_url ~ '^http://(kong|host\.docker\.internal|127\.0\.0\.1|localhost)(:[0-9]{1,5})?/functions/v1/push$'
  ) then
    raise exception using errcode = '22023', message = 'Not a push function URL.';
  end if;
  select s.id into existing_id from vault.secrets as s where s.name = 'push_reminders_url';
  if existing_id is null then
    perform vault.create_secret(p_function_url, 'push_reminders_url', 'M7.2: push Edge Function URL.');
  else
    perform vault.update_secret(existing_id, p_function_url);
  end if;
end;
$$;

revoke execute on function public.configure_push_reminders(text) from public, anon, authenticated;
grant execute on function public.configure_push_reminders(text) to service_role;

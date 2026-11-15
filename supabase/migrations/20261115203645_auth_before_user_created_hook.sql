-- M0.3 (AUTH-2, owner decision option A): block account creation for anyone outside the
-- allowlist with a Supabase Auth "before user created" hook (Postgres function hook).
--
-- Supabase Auth calls this function before it inserts a new auth.users row through a
-- self-service path (OAuth sign-in, sign-up). The function returns '{}' to allow the user or
-- an error object to reject it. Users created through the admin API (service role) do not pass
-- through the hook; that is how local test users are created.
--
-- Wiring: locally in supabase/config.toml ([auth.hook.before_user_created]); on hosted projects
-- in the dashboard (Authentication -> Hooks), see docs/setup/google-auth.md.

-- The only sign-in method of the app (SPEC section 2): Google Sign-In.
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  new_email text := pg_catalog.btrim(event -> 'user' ->> 'email');
  new_provider text := event -> 'user' -> 'app_metadata' ->> 'provider';
begin
  -- Self-service email/password (or any non-Google) sign-up is closed, even for allowlisted
  -- addresses, so nobody can register an allowlisted address before its owner signs in.
  if new_provider is distinct from 'google' then
    return pg_catalog.jsonb_build_object(
      'error', pg_catalog.jsonb_build_object(
        'http_code', 403,
        'message', 'Sign-up is available with Google only.'
      )
    );
  end if;

  if new_email is null
    or new_email = ''
    or not exists (
      select 1
      from public.allowed_users as au
      where pg_catalog.lower(au.email) = pg_catalog.lower(new_email)
    )
  then
    return pg_catalog.jsonb_build_object(
      'error', pg_catalog.jsonb_build_object(
        'http_code', 403,
        'message', 'This account is not allowed to access the app.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

comment on function public.hook_before_user_created(jsonb) is
  'Supabase Auth before-user-created hook: only allowlisted Google accounts may be created (AUTH-2).';

-- Only Supabase Auth may call the hook. Supabase grants EXECUTE on new public functions to
-- anon, authenticated and service_role by default, so revoke those grants explicitly.
revoke execute on function public.hook_before_user_created(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

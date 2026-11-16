-- M0.3 fix round 1: the before-user-created hook also rejects a Google account whose
-- provider reports the email address as unverified. Allowlist matching on an unverified
-- address would let someone who merely claims an allowlisted address be created.
--
-- CREATE OR REPLACE keeps the function's owner and privileges; they are restated below so
-- this migration is correct on its own.

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  new_email text := pg_catalog.btrim(event -> 'user' ->> 'email');
  new_provider text := event -> 'user' -> 'app_metadata' ->> 'provider';
  email_verified text := event -> 'user' -> 'user_metadata' ->> 'email_verified';
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

  -- Google sends email_verified; an explicit false means the address is not proven.
  if email_verified = 'false' then
    return pg_catalog.jsonb_build_object(
      'error', pg_catalog.jsonb_build_object(
        'http_code', 403,
        'message', 'This account''s email address is not verified.'
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

revoke execute on function public.hook_before_user_created(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

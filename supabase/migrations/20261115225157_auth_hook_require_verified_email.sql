-- M0.3 fix round 2: the before-user-created hook accepts only a verified email address
-- (owner decision, option A). The previous version rejected only an explicit false; now any
-- email_verified other than boolean true or the string "true" (case-insensitive) is rejected.
--
-- Supabase Auth v2.197.0 always sends user_metadata.email_verified for OAuth sign-ups: the
-- event's user_metadata is structs.Map(provider Claims), whose EmailVerified field has no
-- omitempty structs tag; for Google it is the provider's verified_email/email_verified flag.
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

  -- Fail closed: only an explicit true (boolean or string, any case) counts as verified.
  -- A missing, null or any other value is rejected.
  if pg_catalog.lower(email_verified) is distinct from 'true' then
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

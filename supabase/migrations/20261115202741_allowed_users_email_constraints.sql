-- M0.2 polish: bound and tighten allowed_users.email.

-- 254 characters is the maximum length of a usable email address (RFC 5321 path limit).
-- Without it an oversized value fails in the unique index (54000) instead of a check (23514).
alter table public.allowed_users
  add constraint allowed_users_email_length check (char_length(email) <= 254);

-- Exactly one "@", non-empty local and domain parts, no whitespace or control characters.
alter table public.allowed_users
  drop constraint allowed_users_email_format;

alter table public.allowed_users
  add constraint allowed_users_email_format
  check (email ~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+$');

-- Local development seed. Fictitious addresses only (RFC 2606 reserved domain).
-- Never put real email addresses here: the real allowlist is inserted per environment
-- with the procedure in README.md ("Allowlist").
insert into public.allowed_users (email, role)
values
  ('owner@example.com', 'owner'),
  ('admin@example.com', 'admin')
on conflict ((lower(email))) do nothing;

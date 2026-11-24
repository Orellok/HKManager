# Supabase keep-alive (M7.1-7, VERIFY-01)

`.github/workflows/keep-alive.yml` keeps both free Supabase projects active (a free project with no activity for about a week can be paused).

- **When:** Sunday, Wednesday and Friday at 04:17 UTC, and on demand (**Actions → Supabase keep-alive → Run workflow**).
- **What:** a read-only `select 1` on staging (`tmistmqyqcnjftovxyoy`) and production (`gnjdyiujvxbwhxmldgfn`) through the pinned Supabase CLI (`supabase db query --remote --read-only`). It reads no table and changes nothing.
- **Secret:** only the existing `SUPABASE_ACCESS_TOKEN` (docs/setup/github-secrets.md). If it is missing, both jobs fail and name the secret. No database password is used.
- **Public repository:** all CLI output is discarded; the log shows only "Keep-alive query on staging: OK" (or failed). No artifacts.
- **Failure:** each environment runs on its own; one failing does not stop the other. GitHub emails the repository owner about a failed scheduled run. Typical causes: expired access token (renew it, section 1 of github-secrets.md) or a project already paused (restore it in the Supabase dashboard).
- **60-day rule:** GitHub disables scheduled workflows in a public repository after 60 days with no repository activity. If that happens, **Actions → Supabase keep-alive → Enable workflow**. Any push to the repository resets the counter.
- **Actions minutes:** public repositories do not use the paid minutes quota; each run takes about 1–2 minutes per environment.

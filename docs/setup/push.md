# Web Push setup (M7.2, NOTIF-4..16)

How the daily push works: pg_cron (06:00 and 07:00 UTC) → `invoke_daily_reminders()` → pg_net POST with a secret from Supabase Vault → Edge Function `push` → Web Push (VAPID) to every saved subscription. The function sends only when it is 09:00 in Asia/Jerusalem and only once per local date (`reminder_runs`).

## Automatic (GitHub Actions, no owner step)
- The migration `20261129090000_m7_2_push.sql` enables pg_cron / pg_net and **fails with a clear message if either is missing** (VERIFY-04 proof on staging). It creates the two cron jobs and a random cron secret in Vault (never in the repo).
- After the migrations, **Staging migrations** / **Production migrations** deploy the `push` function (`supabase functions deploy push --use-api --no-verify-jwt`) and store the function URL in Vault (`configure_push_reminders`). Nothing from the database is printed.

## Owner steps – once per environment (staging first, then production)
Never commit the key file and never paste the private key into a chat.

1. **Generate the keys** on your computer (repo checkout, `pnpm install` done):
   `node scripts/generate-push-keys.mts staging`
   It writes `supabase/.env.push.staging.local` (git-ignored, readable by you only) and prints the **public** key.
2. **Store them as Edge Function secrets** (Supabase CLI logged in with `pnpm exec supabase login`):
   `pnpm exec supabase secrets set --env-file supabase/.env.push.staging.local --remote=tmistmqyqcnjftovxyoy --yes`
   (production: `production`, ref `gnjdyiujvxbwhxmldgfn`). This sets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
3. **GitHub → Settings → Secrets and variables → Actions → Variables:** add `STAGING_NEXT_PUBLIC_VAPID_PUBLIC_KEY` (production: `PRODUCTION_NEXT_PUBLIC_VAPID_PUBLIC_KEY`) = the public key from step 1. It is public by design (it is in the browser bundle). The deploy warns while it is missing; push then shows "לא נתמך" with "שליחת התראות עדיין לא הוגדרה בסביבה הזו".
4. **Redeploy** (next merge to `main`, or re-run the latest **Staging deploy**).
5. Keep the key file in a password manager or delete it. New keys (`--force`) make every device turn notifications on again.

## Check that it works
- Settings → "התראות במכשיר זה" → "הפעל התראות במכשיר זה" → "שלח התראת בדיקה".
- Supabase dashboard → Integrations → Cron: jobs `push-daily-reminders-0600-utc` and `-0700-utc`; their run history shows **failed** with "Push reminders are not configured" only if the URL step did not run.
- Edge Functions → `push` → Logs: failures are logged by status code only (no endpoint, no content).
- Table `reminder_runs`: one row per day with the counts and sent / failed.

## Manual fallback (only if the workflow step failed)
SQL editor, as postgres: `select public.configure_push_reminders('https://<project-ref>.supabase.co/functions/v1/push');`
Function deploy from a checkout: `pnpm exec supabase functions deploy push --use-api --no-verify-jwt --remote=<ref> --yes`.

## Final acceptance (owner, not a blocker for the build)
The device checklist in docs/verify/VERIFY-04-web-push.md ("רשימת בדיקה למכשיר"), on both phones, after push is live on staging.

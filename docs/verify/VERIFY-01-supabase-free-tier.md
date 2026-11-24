# VERIFY-01 – Supabase free tier (checked 2026-11-23)

Method: web search restricted to official sources where possible. supabase.com is blocked from the cloud session's network (WebFetch: ENOTFOUND), so official pages could not be opened directly; findings rely on search-result excerpts of the official pages listed. Owner re-checks the pricing page in the dashboard when creating the projects.

## Question (SPEC 13)
Current Supabase free-tier terms: pausing of inactive projects, DB/Storage limits, number of free projects (we need two: staging + production).

## Findings

| Item | Finding | Source (checked 2026-11-23) | Confidence |
|---|---|---|---|
| Number of free projects | 2 active free projects per account. Paused projects do not count toward the limit. | https://supabase.com/docs/guides/platform/free-project-pausing ; https://supabase.com/kb/faqs/platform/free-project-pausing ; https://supabase.com/pricing | High (official, via excerpt) |
| Inactivity pause | A Free project is paused if it "does not receive sufficient user database activity over the past week". Owner gets warning emails before pausing. Paid plans are exempt. Exact threshold of "sufficient activity" is not documented in the excerpts. | https://supabase.com/docs/guides/platform/free-project-pausing | High (rule) / **OPEN** (exact threshold) |
| Database size | 500 MB (0.5 GB) per active project; paused/deleted projects do not count. | https://supabase.com/changelog/33121-relaxing-database-size-limit-on-free-plan-0-5-gb-database-size-per-project ; https://supabase.com/pricing | High |
| File storage | 1 GB | https://supabase.com/docs/pricing ; https://supabase.com/docs/guides/platform/billing-on-supabase | High (official, via excerpt) |
| Egress | 5 GB (+5 GB cached egress), shared by DB + Storage | same as above | High (official, via excerpt) |
| Auth MAU | 50,000 | https://supabase.com/docs/pricing | Medium (one search noted conflicting/older numbers) |
| Edge Function invocations | 500,000 / month, no overage billing on Free (see VERIFY-04) | https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations | High |
| Commercial use on Free | Not found stated either way in the excerpts. | – | **OPEN** (owner to read ToS at signup) |

## Verdict
**PASS-with-conditions.** Two free projects are allowed and our data volume (2 users, receipts metadata, small file attachments) fits 500 MB DB / 1 GB storage / 5 GB egress. Condition: weekly-inactivity pausing is real and must be prevented.

## Impact on our design
1. **Keep-alive is required** (SPEC 15 "זמינות" is now confirmed): staging will often be idle more than 7 days, production may be too during vacations. The weekly backup cron alone (every 7 days) is on the edge of the 1-week window; recommendation: run a separate keep-alive DB query **at least twice a week** (e.g. a lightweight GitHub Actions cron, or the daily pg_cron job of NOTIF-16 – but pg_cron inside the DB likely does not count as "user activity"; **OPEN**, so do not rely on it). Keep-alive must be a real query through the API/DB connection.
2. **Storage budget:** 1 GB file storage and 5 GB egress → compress/resize uploaded receipt images client-side before upload; use signed URLs (already in SPEC). Add usage check to the hardening milestone.
3. Pause risk is a reminder in the runbook: restoring a paused project is done from the dashboard (owner action).

## What the owner must do
- When creating the two projects: confirm in the dashboard that both are on the Free plan and read the current ToS (commercial use) – record result here.
- Watch for Supabase "project will be paused" emails; add them to an inbox filter that is actually read.

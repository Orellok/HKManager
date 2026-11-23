# VERIFY-04 – Web Push, pg_cron and Edge Functions on Supabase Free (checked 2026-11-23)

Method: web search on official sources. supabase.com is blocked from the cloud session's network (WebFetch: ENOTFOUND); findings rely on search-result excerpts. Device behaviour can only be tested by the owner on the real phones.

## Question (SPEC 13)
(a) Availability and limits of `pg_cron` and Edge Functions on Supabase Free; (b) sending Web Push (VAPID) from the Edge Functions runtime; (c) Web Push in Chrome on both users' Android devices, incl. vendor battery-saving settings. If any fails → stop and escalate (alternative: Netlify Scheduled Function).

## Findings

| Item | Finding | Source (checked 2026-11-23) | Confidence |
|---|---|---|---|
| Edge Functions on Free | Included; 500,000 invocations/month, no overage billing on Free. Invocations counted regardless of status code. | https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations ; https://supabase.com/docs/guides/functions/pricing | High |
| Edge Function limits | Memory 256 MB; wall clock 150 s on Free (400 s paid). CPU time: sources conflict (2 s vs 200 ms of active CPU per request). | https://supabase.com/docs/guides/functions/limits ; https://supabase.com/docs/guides/troubleshooting/edge-function-cpu-limits | High (memory/wall) / Medium (CPU) |
| pg_cron → Edge Function | Official: hosted platform supports `pg_cron` + `pg_net` to invoke Edge Functions on a schedule. Supabase Cron guidance: max ~8 concurrent jobs, each ≤10 min. Module stage listed as Beta. | https://supabase.com/docs/guides/functions/schedule-functions ; https://supabase.com/docs/guides/cron ; https://supabase.com/features/supabase-cron | High |
| pg_cron on **Free** plan | No official excerpt states plan availability; third-party guides say all plans incl. Free. | third-party only | **OPEN** – confirm on first staging setup (Integrations → Cron / `create extension pg_cron`) |
| npm packages in Edge Functions | Supported via `npm:` specifier (and `jsr:`), per-function `deno.json`; GA since Dec 2023. No file-system APIs. | https://supabase.com/docs/guides/functions/dependencies ; https://supabase.com/blog/edge-functions-node-npm | High |
| Web Push libraries on Deno/edge | Classic `web-push` (Node) relies on Node-specific APIs and is reported failing on some edge runtimes; not confirmed for Supabase. Web-Crypto-based alternatives exist: `@pushforge/builder` (states Deno support), `jsr:@negrel/webpush` (Deno-native, VAPID). | https://github.com/web-push-libs/web-push ; https://github.com/draphy/pushforge ; https://jsr.io/@negrel/webpush | Medium (libraries' own docs; not official Supabase) |
| Supabase official push example | Expo/FCM, not Web Push – no official Web Push sample. | https://supabase.com/docs/guides/functions/examples/push-notifications | High |
| Android Doze / urgency | FCM: normal-priority messages may be delayed in Doze (screen off); high priority delivered immediately. Web Push equivalent is the RFC 8030 `Urgency: high` header. How Chrome's push service maps `Urgency` to Doze is not officially documented in the results. | https://firebase.google.com/docs/cloud-messaging/android-message-priority | Medium |
| Real-device delivery incl. vendor battery savers | Cannot be verified by agents. | – | **NEEDS-OWNER** |

## Verdict
- (a) Edge Functions on Free: **PASS**. pg_cron on Free: **PASS-with-conditions** (officially documented feature on the hosted platform; Free availability to be confirmed on staging – trivial check, no owner decision).
- (b) Web Push from Edge runtime: **PASS-with-conditions** – proven only by a working spike on staging; library choice is a new dependency (SPEC 0.3) → see "Impact" 2.
- (c) Device delivery: **NEEDS-OWNER** (checklist below).
Overall: **PASS-with-conditions + NEEDS-OWNER for device test.** No blocker found; Netlify fallback not needed at this point.

## Impact on our design
1. NOTIF-16 stays as specified (pg_cron 06:00 + 07:00 UTC → Edge Function, local-hour check, `reminder_runs` idempotency). Usage: ~60 invocations/month + test pushes – far below 500k.
2. **Library:** do not use Node `web-push` unless a staging spike shows it works on Supabase's runtime. Lead recommendation: spike with a Web-Crypto library (`@pushforge/builder` or `jsr:@negrel/webpush`), pin exact version; record the choice as a dependency decision in PROGRESS.md (SPEC 0.3).
3. Send with `Urgency: high` and a TTL (e.g. 12h) so a morning summary is not dropped or delivered next day; NOTIF-11 handling of 404/410 unchanged.
4. pg_cron job must call the function with a secret (not public) – function deployed with JWT verification or a shared secret header; VAPID private key in function secrets (as SPEC).
5. Keep CPU work tiny (no heavy crypto loops; few subscriptions) given the uncertain CPU limit.
6. VERIFY-01 link: pg_cron activity is likely not "user activity" for the pause rule – keep-alive still needed.

## What the owner must do
Run the device checklist below on **both** phones after M7 Push is on staging, and report results (phone model, Android version, pass/fail per step).

### רשימת בדיקה למכשיר (בעל המוצר, לכל אחד משני הטלפונים)
1. רשום: דגם הטלפון, גרסת Android, גרסת Chrome.
2. פתח את האפליקציה (staging) ב-Chrome → הגדרות → "הפעל התראות במכשיר זה" → אשר הרשאה. המצב מוצג "פעיל".
3. "שלח התראת בדיקה" כשהאפליקציה פתוחה → ההתראה מגיעה תוך דקה.
4. סגור את Chrome לגמרי (החלק מהאפליקציות האחרונות) → שלח שוב בדיקה (מהמכשיר השני / מהמחשב) → מגיעה?
5. נעל מסך והשאר את הטלפון בלי לגעת **שעה לפחות** (מצב Doze) → שלח בדיקה → רשום את זמן ההגעה בפועל.
6. בדיקת לילה: השאר משימה עם דדליין להיום, טלפון נעול כל הלילה → ההתראה של 09:00 מגיעה עד 09:05?
7. הגדרות הטלפון → סוללה → Chrome: רשום את המצב (מוגבל / מותאם / ללא הגבלה). אם ההתראות מתעכבות – העבר ל"ללא הגבלה" (Samsung: "אפליקציות במצב שינה" – לוודא ש-Chrome לא ברשימה) וחזור על 5–6.
8. לחיצה על ההתראה פותחת את מסך המשימות.
9. בטל את ההרשאה בהגדרות Chrome → מסך ההגדרות באפליקציה מציג "חסום בדפדפן".
10. דווח: לכל שלב עבר/נכשל + זמן הגעה.

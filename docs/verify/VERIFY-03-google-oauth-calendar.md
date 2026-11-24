# VERIFY-03 – Google OAuth policy for the Calendar scope (checked 2026-11-23)

Method: web search on official Google sources (developers.google.com, support.google.com). developers.google.com is blocked from the cloud session's network (WebFetch: ENOTFOUND), so pages could not be opened directly; findings rely on search-result excerpts of the official pages listed.

## Question (SPEC 13)
Refresh-token lifetime in Testing mode; meaning of Production without verification; the right path for an app with 2 users. (Also: classification of `drive.file` for VERIFY-05.)

## Findings

| Item | Finding | Source (checked 2026-11-23) | Confidence |
|---|---|---|---|
| Testing mode token expiry | External user type + publishing status "Testing" → refresh tokens expire **7 days** after consent, unless the app requests only basic identity scopes (name, email, profile). | https://developers.google.com/identity/protocols/oauth2 ("Refresh token expiration"); https://support.google.com/cloud/answer/15549945 | High (official) |
| Fix for 7-day expiry | Change publishing status to "In production". Tokens issued while in Testing keep the short life → re-consent after publishing. | https://developers.google.com/google-ads/api/docs/get-started/common-errors ; https://developers.google.com/identity/protocols/oauth2/production-readiness/overview | High |
| Production without verification | App requesting sensitive/restricted scopes without completed verification = "unverified app": users see the "Google hasn't verified this app" screen and click through; **100 new-user cap for the lifetime of the project**, cannot be reset. | https://support.google.com/cloud/answer/7454865 | High (official) |
| Personal-use exemption | Personal-use apps used by fewer than 100 users, all known to the developer, can continue without verification (users click through the warning). | https://support.google.com/cloud/answer/13464323 ; https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification | High (official, via excerpt) |
| Internal user type | Apps restricted to one Google Workspace / Cloud Identity org are not subject to the unverified screen or the cap. Requires both users to be in the same Workspace org. | https://support.google.com/cloud/answer/13464323 | High; **does not apply** unless both accounts are in one Workspace org (OPEN – owner confirms account types) |
| `calendar.events` classification | Google lists "reading events stored in Google Calendar" as an example of a sensitive scope; the exact label for `calendar.events` was not visible in the excerpts. | https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification ; https://developers.google.com/calendar/api/auth | Medium – treat as **sensitive**; **OPEN** until seen on the Console "Data access" page |
| Narrower Calendar scopes | Not verified whether a narrower scope than `calendar.events` exists that still allows read+write of events on one calendar. | – | **OPEN** (dev checks the Calendar auth page when implementing M5) |
| Other refresh-token revocation causes | User revokes access; token unused for 6 months; per-account-per-client token cap (Google forum: 100, older sources 50 – oldest silently invalidated). | Google forums / third-party (official page not reachable) | Medium |
| `drive.file` (for VERIFY-05) | **Non-sensitive**, "Recommended" in Google's Drive scope guide. | https://developers.google.com/workspace/drive/api/guides/api-specific-auth | High (official) |

## Verdict
**PASS-with-conditions.** Recommended path for 2 known users: **External user type, publishing status "In production", no verification submission** (personal-use exemption). Conditions: both users click through the unverified-app warning once per consent; the project-lifetime cap of 100 users is irrelevant for us; never leave the client in Testing (7-day expiry would break the calendar weekly).

## Impact on our design
1. Production and staging OAuth clients (SPEC 15: separate client for staging) must each live in a project whose consent screen is "In production". If staging is a separate Cloud project, publish it too, or staging calendar tokens die every 7 days.
2. CAL-10 ("reconnect" button, no silent failure) remains mandatory: tokens can still be revoked (user revoke, 6-month disuse, token cap). Handle `invalid_grant` → mark disconnected → show reconnect.
3. Store only the latest refresh token per user (`google_tokens`), and avoid needless re-consent loops (each consent issues a new token and counts toward the per-client cap).
4. Sign-in (basic scopes) and calendar (sensitive, incremental) as in SPEC 9 – compatible with this path.
5. Do **not** submit for verification unless the owner decides to; verification brings review, demo video, privacy policy requirements.

## What the owner must do
- In Google Cloud Console (each project used): OAuth consent screen → User type External → add app name/support email → **Publish app** ("In production"). Do not request verification.
- On the Data access page: confirm the label shown for `calendar.events` (sensitive/restricted) and record it here.
- Confirm whether the two Google accounts are consumer (gmail.com) or in one Workspace org (if same org, "Internal" is an alternative).
- First connect: expect the "Google hasn't verified this app" screen → Advanced → continue. Tell the second user in advance.

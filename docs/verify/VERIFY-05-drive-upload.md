# VERIFY-05 – Automatic upload to a personal Google Drive from GitHub Actions (checked 2026-11-23)

Method: web search on official sources (developers.google.com, support.google.com, docs.github.com). developers.google.com is blocked from the cloud session's network; findings rely on search-result excerpts. See also VERIFY-03 (same OAuth policies).

## Question (SPEC 13)
Uploading backups to the Drive of a regular (consumer) Google account from GitHub Actions: is a user OAuth refresh token required (not a service account), and how long does the token stay valid?

## Findings

| Item | Finding | Source (checked 2026-11-23) | Confidence |
|---|---|---|---|
| Service account → personal My Drive | Service accounts have **no Drive storage quota**; uploads into a user's My Drive fail with 403 `storageQuotaExceeded`. Workarounds: shared drives (Workspace only) or domain-wide delegation (Workspace only) – neither exists for a consumer account. Recommended alternative: OAuth on behalf of the human user. | https://developers.google.com/workspace/drive/api/guides/limits ; Google Workspace admin help "storage and upload limits"; Google developer forum https://discuss.google.dev/t/storagequotaexceeded-the-users-drive-storage-quota-has-been-exceeded-for-service-account/104375 | High |
| `drive.file` scope | Non-sensitive, "Recommended"; access only to files the app created or the user opened/shared with the app. Non-sensitive → no unverified-app screen / 100-user cap from this scope. | https://developers.google.com/workspace/drive/api/guides/api-specific-auth ; https://support.google.com/cloud/answer/7454865 | High |
| Token lifetime – Testing | 7-day expiry applies to all scopes except basic identity scopes → `drive.file` token in Testing dies after 7 days. | https://developers.google.com/identity/protocols/oauth2 | High |
| Token lifetime – Production | No fixed expiry. Revoked if: user revokes access; unused for 6 months; per-account-per-client token cap exceeded (oldest invalidated). | Google forums / third-party (official section not reachable) | Medium |
| GitHub scheduled workflows | In a **public** repository, scheduled workflows are auto-disabled after 60 days without repository activity. | https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows | High (wording seen in GHES copy of the doc) |
| Run failure notification | GitHub emails on failed scheduled runs (SPEC relies on this) – not re-verified here. | – | OPEN (minor) |

## Verdict
**PASS-with-conditions.** A user OAuth refresh token (owner's business Google account, `drive.file`, separate OAuth client as SPEC 15 says) is **required** – a service account cannot store files in a consumer My Drive. The token is long-lived only if the consent screen is **"In production"**; weekly use keeps it far from the 6-month inactivity rule.

## Impact on our design
1. Backup job: GitHub Actions exchanges the refresh token (GitHub Secret) for an access token each run; creates/uses a folder **created by the app itself** (with `drive.file` the app cannot see a folder the user created manually unless opened via Picker).
2. Retention (keep 12, delete older after verified upload) works because all backups are app-created files.
3. Failure handling: `invalid_grant` must fail the job loudly (GitHub failure email to admin) with a log line "refresh token revoked – re-run the token bootstrap" (no token in logs).
4. One-time **token bootstrap script/runbook** (local, owner runs it once): OAuth consent with `access_type=offline` + `prompt=consent`, prints the refresh token to paste into GitHub Secrets. Re-run only when revoked (avoids token-cap churn).
5. Same Production-status rule as VERIFY-03 for the Drive OAuth client's project.
6. If the repo is public: scheduled workflow can be auto-disabled after 60 days idle → keep-alive/activity or re-enable alert in runbook. Private repo: rule is stated for public repos only.

## What the owner must do
- Create the separate OAuth client (Desktop or Web type) for backups in a project whose consent screen is **published ("In production")**; enable Drive API.
- Run the bootstrap once with the business Google account and store the refresh token in GitHub Secrets (agents provide the script; only the owner can consent).
- Confirm repository visibility (public/private) so the 60-day rule can be handled.

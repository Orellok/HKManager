# Environments

| Environment | Supabase project | Project ref | URL |
|---|---|---|---|
| Local | Supabase CLI (`pnpm db:start`) | – | http://127.0.0.1:54321 |
| Staging | hkmanager-staging | `tmistmqyqcnjftovxyoy` | https://tmistmqyqcnjftovxyoy.supabase.co |
| Production | hkmanager-prod | `gnjdyiujvxbwhxmldgfn` | https://gnjdyiujvxbwhxmldgfn.supabase.co |

## Netlify sites

| Environment | Site | Site ID (GitHub variable) |
|---|---|---|
| Staging | https://hkmanager-staging.netlify.app | `985011fc-0c30-406d-95b7-d402c00203fb` → `NETLIFY_STAGING_SITE_ID` |
| Production | https://hkmanager.netlify.app | `83949b79-7bd1-4ac9-9543-08aadd78e3b3` → `NETLIFY_PRODUCTION_SITE_ID` |

Secrets (DB passwords, service role / secret keys) are never stored in the repository or sent in chat. They live in GitHub Secrets / Netlify environment variables.

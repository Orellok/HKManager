# גיבוי שבועי ל-Google Drive (M7.3, SPEC 8)

מה קורה: כל **שבת ב-02:41 UTC** ה-workflow **Weekly backup** (`.github/workflows/backup.yml`) מגבה את **production**: `pg_dump` של הנתונים (סכמות `public` ו-`auth`) + כל הקבצים ב-Storage (קבלות, צילומי הוצאות) → קובץ אחד `hkmanager-production-<תאריך ושעה>Z.tar.gz` → תיקייה **"HKManager backups"** ב-Google Drive של חשבון המייל העסקי. אחרי שההעלאה **אומתה** (גודל + MD5 זהים) נמחקים גיבויים ישנים: נשמרים **12 האחרונים** לכל סביבה.

- **הצפנה:** אין (החלטת בעל המוצר, SPEC 8). ההגנה היא אבטחת חשבון ה-Google: אימות דו-שלבי, לא לשתף את התיקייה ולא ליצור לה קישור שיתוף. ה-job עצמו לעולם לא משתף.
- **הרשאה מצומצמת:** scope `drive.file` בלבד – האפליקציה רואה רק את התיקייה והקבצים שהיא עצמה יצרה, לא שום דבר אחר ב-Drive.
- **repo ציבורי:** הלוג מציג רק תוצאה, ספירות וגדלים. אין artifacts, אין נתונים או שמות קבצים בלוג, והקבצים הזמניים נמחקים בסוף הריצה.
- **כישלון:** הריצה נכשלת ו-GitHub שולח מייל ל-admin (סעיף 6).
- **staging:** לא מגובה אוטומטית (אין בו נתוני אמת). אפשר להריץ ידנית לבדיקת התהליך (סעיף 4).

## דרישות מוקדמות
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROD_DB_PASSWORD` (ו-`SUPABASE_STAGING_DB_PASSWORD` לריצת staging) – כבר קיימים (`docs/setup/github-secrets.md`). לא נדרש סוד Supabase נוסף: מפתח השירות ל-Storage נקרא בזמן הריצה עם ה-access token.
- במחשב שלך: עותק של ה-repo אחרי `pnpm install`, ו-**Node 22.18 ומעלה** (`node --version`; גרסה ישנה יותר לא מריצה קובצי `.mts`).

## 1. פרויקט ו-OAuth client נפרד ב-Google Cloud (פעם אחת, ~10 דקות)
SPEC 8 דורש client נפרד מזה של הכניסה והיומן. המלצה: פרויקט נפרד, כדי שאפשר לפרסם אותו מיד.
1. https://console.cloud.google.com → פרויקט חדש: `HKManager Backup`.
2. **APIs & Services → Library → Google Drive API → Enable.**
3. **Google Auth Platform (OAuth consent screen):**
   - Branding: App name `HKManager Backup`, מייל תמיכה ומפתח – של ה-admin. בלי לוגו.
   - Audience: **External**, ואז **Publish app → In production**. חובה: במצב Testing ה-token פג אחרי 7 ימים והגיבוי ייכשל (VERIFY-05). לא נדרש אימות של Google – `drive.file` אינו scope רגיש.
   - Data access: להוסיף רק `.../auth/drive.file`.
4. **Clients → Create client → Desktop app**, שם `HKManager backup`. **Download JSON** – זה קובץ `client_secret_….json`. לשמור אותו מחוץ ל-repo (למשל בתיקיית ההורדות) ולא לשתף.

## 2. הפקת ה-refresh token (פעם אחת, ~3 דקות)
בתיקיית ה-repo:
```bash
node scripts/backup/get-drive-token.mts ~/Downloads/client_secret_XXXX.json
```
1. הסקריפט מדפיס כתובת. לפתוח אותה בדפדפן שמחובר ל-**חשבון ה-Google העסקי של בעלת העסק** (מומלץ חלון גלישה פרטית והתחברות לחשבון הזה; או שבעלת העסק תאשר במחשב שלך).
2. יופיע מסך "Google hasn't verified this app" → **Advanced → Go to HKManager Backup**. לסמן את ההרשאה ל-Google Drive ולאשר.
3. הדפדפן יציג "ההרשאה התקבלה". הסקריפט כותב את שלושת הערכים לקובץ `.env.drive-backup.local` בשורש ה-repo (מוחרג מ-git, קריא לך בלבד), בודק את ההרשאה ויוצר את התיקייה "HKManager backups" ב-Drive. ה-token לא מודפס למסך.

הסקריפט מסרב לדרוס קובץ קיים; `--force` מחליף אותו (כל הרצה יוצרת token חדש – להריץ רק כשצריך).

## 3. שמירה ב-GitHub Secrets
הכי פשוט (GitHub CLI מחובר): `gh secret set -f .env.drive-backup.local`
או ידנית: **GitHub → Settings → Secrets and variables → Actions → New repository secret**, שלושה סודות בשמות האלה בדיוק, עם הערכים מהקובץ:
- `GOOGLE_DRIVE_BACKUP_CLIENT_ID`
- `GOOGLE_DRIVE_BACKUP_CLIENT_SECRET`
- `GOOGLE_DRIVE_BACKUP_REFRESH_TOKEN`

אחר כך למחוק את הקובץ: `rm .env.drive-backup.local`. **לא להדביק את הערכים בצ'אט, ב-issue או ב-commit.**

## 4. ריצה ראשונה ובדיקה
1. **Actions → Weekly backup → Run workflow** → environment `staging` (בדיקת תהליך בלי נתוני אמת) ואחר כך `production`.
2. בלוג אמורות להופיע השורות: `Google Drive: OK`, `Database dump: OK (…)`, `Storage export: OK (…)`, `Archive: …`, `Upload: verified …`, `Retention: …`, `Backup of production: done`.
3. ב-Drive של החשבון העסקי: תיקייה **HKManager backups** עם הקובץ. לא לשנות את שם התיקייה ולא להעביר אליה קבצים אחרים (האפליקציה מוצאת אותה לפי השם; אם נמחקה – תיווצר חדשה).
4. לפני העלייה לאוויר: תרגול שחזור על staging לפי `docs/setup/restore.md`.

## 5. כלל 60 הימים
ב-repo ציבורי GitHub משבית workflows מתוזמנים אחרי 60 יום בלי פעילות ב-repo. אם זה קורה (מגיע מייל מ-GitHub): **Actions → Weekly backup → Enable workflow** (וכך גם ל-Supabase keep-alive). כל push ל-repo מאפס את הספירה.

## 6. מה לעשות כשמגיע מייל על כישלון
לפתוח את הריצה ב-Actions ולקרוא את שורת ה-`::error::`:
| הודעה | פעולה |
|---|---|
| `refused the refresh token (invalid_grant)` | ה-token בוטל או פג (בוטלה הגישה בחשבון Google, הפרויקט חזר ל-Testing, או 6 חודשים בלי שימוש). להריץ שוב את סעיף 2 עם `--force` ולעדכן את `GOOGLE_DRIVE_BACKUP_REFRESH_TOKEN`. |
| `The … secret is not set` | להוסיף את הסוד שבשם (סעיף 3 או `github-secrets.md`). |
| `Database … dump failed` | בדרך כלל access token של Supabase שפג או סיסמת DB שהשתנתה (`github-secrets.md`). להריץ מקומית `pnpm exec supabase db dump --remote=<ref> --data-only -f /tmp/x.sql` כדי לראות את השגיאה. |
| `HTTP 403 (accessNotConfigured)` | Google Drive API לא מופעל בפרויקט (סעיף 1.2). |
| `HTTP 403 (storageQuotaExceeded)` | ה-Drive מלא – לפנות מקום בחשבון. |
| `HTTP 5xx` / `network error` | תקלה זמנית: Re-run jobs. |

ביטול גישה (למשל בסיום עבודה): בחשבון Google העסקי → **Security → Third-party apps → HKManager Backup → Remove access**; הגיבוי ייכשל עד הפקת token חדש.

## 7. גודל ועלות
פרויקט ציבורי ב-GitHub לא צורך דקות Actions בתשלום. גיבוי טיפוסי: כמה MB עד עשרות MB, בעיקר הקבצים; 12 עותקים נכנסים בקלות ב-15GB החינמיים של Google.

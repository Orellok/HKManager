# נוהל שחזור מגיבוי (M7.3, SPEC 8)

הגיבוי (`docs/setup/backups.md`) הוא קובץ `hkmanager-<סביבה>-<תאריך>Z.tar.gz` ב-Drive, ובו:
- `db/data.sql` – כל הנתונים של `public` ו-`auth` (משתמשים, לקוחות, פרויקטים, הכנסות, הוצאות, משימות…).
- `db/schema.sql` – הסכמה, לעיון בלבד. **הסכמה משוחזרת מה-migrations של ה-repo**, כי הן יוצרות גם את מה שה-dump לא כולל: buckets של Storage, משימות pg_cron, סוד ה-cron ב-Vault והיסטוריית ה-migrations.
- `storage/<bucket>/…` – כל הקבצים. `manifest.json` – commit, migration אחרונה, ספירת שורות לכל טבלה ו-SHA-256 לכל קובץ.

הסקריפט `scripts/backup/restore.mts` בודק את כל ה-checksums, טוען את הנתונים **בטרנזקציה אחת** (בסוף בודק שספירת השורות בכל טבלה זהה ל-manifest; כל שגיאה = שום דבר לא משתנה), ואז מעלה את כל הקבצים ל-Storage. הוא מסרב לשחזר לתוך פרויקט שכבר יש בו נתונים, אלא אם מעבירים `--replace`.

אובדן נתונים מקסימלי: עד 7 ימים (סיכון שהתקבל, SPEC 8).

## דרישות
- עותק של ה-repo אחרי `pnpm install`, **Node 22.18 ומעלה**.
- `psql` (PostgreSQL client) גרסה 17, או 16.10 ומעלה (גרסה ישנה לא מכירה את `\restrict` שב-dump). macOS: `brew install libpq`; Ubuntu: `sudo apt install postgresql-client`; Windows: התקנת PostgreSQL עם "Command Line Tools" בלבד.
- Supabase CLI מחובר: `pnpm exec supabase login`.

## 1. להוריד את הגיבוי
ב-Drive של החשבון העסקי → תיקייה **HKManager backups** → להוריד את הקובץ האחרון של `production`. לשמור מחוץ ל-repo. לבדוק לאיזה commit הוא שייך:
```bash
tar -xzOf ~/Downloads/hkmanager-production-XXXX.tar.gz manifest.json | grep -E '"(commit|latestMigration|createdAt)"'
```

## 2. לבחור יעד
- **פרויקט Supabase חדש (מומלץ)** – כשפרויקט ה-production נמחק, נפגע או לא ברור מה מצבו. בתוכנית החינמית מותרים 2 פרויקטים פעילים: אם צריך מקום, להשהות (Pause) את staging.
- **אותו פרויקט** – רק אם הסכמה תקינה ועדכנית (ה-migrations רצו) והבעיה היא בנתונים בלבד. דורש `--replace`, שמוחק את כל הנתונים בטבלאות שבגיבוי ומחליף אותם.

## 3. פרויקט חדש: סכמה מה-migrations
1. Supabase Dashboard → New project (אותו אזור כמו קודם), סיסמת DB חזקה במנהל הסיסמאות. לרשום את ה-ref החדש (20 אותיות).
2. ב-repo: `git checkout <commit מה-manifest>` (או main, אם ה-migration האחרונה שם זהה ל-`latestMigration`).
3. `pnpm exec supabase link --project-ref <ref חדש>` ואז `pnpm exec supabase db push` (מבקש את סיסמת ה-DB).
4. `git checkout -` לחזרה לענף.

## 4. השחזור
ערכים מה-Dashboard של פרויקט היעד:
- **RESTORE_DB_URL** – Connect → **Session pooler** → URI (עם הסיסמה במקום `[YOUR-PASSWORD]`).
- **RESTORE_API_URL** – `https://<ref>.supabase.co`.
- **RESTORE_SERVICE_KEY** – Settings → API Keys → `service_role` (או secret key).

הקלדה בלי שהערכים יישמרו בהיסטוריה:
```bash
read -rs RESTORE_DB_URL && export RESTORE_DB_URL
read -rs RESTORE_SERVICE_KEY && export RESTORE_SERVICE_KEY
export RESTORE_API_URL=https://<ref>.supabase.co
node scripts/backup/restore.mts ~/Downloads/hkmanager-production-XXXX.tar.gz --yes
# לאותו פרויקט שיש בו נתונים: להוסיף --replace
unset RESTORE_DB_URL RESTORE_SERVICE_KEY
```
פלט תקין מסתיים ב-`Database: restored … (counts verified)`, `Storage: uploaded … objects`, `Restore: done`. הודעת `already holds data` = היעד לא ריק (סעיף 2). כל כישלון במסד הנתונים מבוטל כולו – אפשר לתקן ולהריץ שוב.

## 5. אחרי שחזור לפרויקט חדש
1. **Auth:** הגדרות Google provider, redirect URLs וה-auth hook לפי `docs/setup/supabase-auth.md`; ב-Google Cloud להוסיף ל-client של הכניסה את `https://<ref חדש>.supabase.co/auth/v1/callback`.
2. **Push:** `pnpm exec supabase secrets set --env-file supabase/.env.push.production.local --remote=<ref חדש> --yes` עם **אותם** מפתחות VAPID (אז המכשירים ממשיכים לקבל התראות; מפתחות חדשים = כל מכשיר מפעיל מחדש).
3. **ref חדש בקוד:** להחליף את `gnjdyiujvxbwhxmldgfn` ב-ref החדש ב-`.github/workflows/production-migrations.yml`, `keep-alive.yml`, `backup.yml` וב-`docs/setup/environments.md` (שינוי בקוד דרך PR); לעדכן את הסוד `SUPABASE_PROD_DB_PASSWORD`. אחרי המיזוג, **Production migrations** פורס את פונקציית ה-push ומגדיר את ה-cron.
4. **Netlify:** משתני `PRODUCTION_NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` (`docs/setup/deploy.md`), ואז deploy.
5. כולם מתחברים מחדש (מפתחות ה-JWT של פרויקט חדש שונים).
6. בדיקה: כניסה, דף הבית, לקוח ופרויקט מוכרים, פתיחת קבלה ותמונת הוצאה, ייצוא CSV.

## 6. תרגול שחזור
### תרגול מקומי (בוצע 2026-11-24 – PASS)
`node scripts/backup/restore-drill.mts --reset-local-database` על ה-stack המקומי: יוצר גיבוי באותו קוד שרץ ב-workflow (pg_dump דרך ה-CLI + כל אובייקטי ה-Storage, עם קבצי סימון בשני ה-buckets ושורת לקוח), מאפס את מסד הנתונים מה-migrations בלי seed (= פרויקט חדש), מוודא שהקבצים נעלמו, משחזר, ובודק שכל טבלה זהה בספירה וב-hash של התוכן ושכל קובץ זהה ב-SHA-256; אחר כך מוודא ששחזור חוזר בלי `--replace` נדחה ועם `--replace` מצליח וזהה. תוצאה:
```
Database dump: OK (43 tables, 134 rows, 0.1 MB)
Storage export: OK (4 objects in 2 buckets, 0.0 MB)
After reset: 4 of 4 objects unavailable
Database: restored 134 rows in 43 tables (counts verified)
Storage: uploaded 4 objects
Restore over existing data without --replace: refused, nothing changed
Restore drill: PASS (43 tables / 134 rows identical by count and content hash; 4 objects identical by SHA-256)
```

### תרגול על staging (לבצע פעם אחת לפני העלייה לאוויר)
מוכיח את החלק שלא ניתן לבדוק מקומית: חיבור דרך ה-pooler, הרשאות `postgres` בפרויקט מנוהל ו-Storage בענן. staging בלבד – אין בו נתוני אמת.
1. **Actions → Weekly backup → Run workflow → staging**, ולהוריד את הקובץ מה-Drive.
2. סעיף 4 עם ערכי staging (ref `tmistmqyqcnjftovxyoy`) ו-`--replace`.
3. לוודא שהפלט מסתיים ב-`Restore: done`, ושהאפליקציה ב-staging נפתחת ומציגה את אותם נתונים.
4. לרשום את התאריך והתוצאה כאן.

# הגדרת סודות ב-GitHub – workflows של migrations (M0.4)

מטרה: לאפשר ל-GitHub Actions להריץ את ה-migrations על פרויקט ה-staging ועל פרויקט ה-production ב-Supabase.
זמן משוער: 10–15 דקות. ממשקי Supabase ו-GitHub משתנים מדי פעם; אם מסך נראה אחרת – לפעול לפי המשמעות.

> **אזהרה: אין להדביק אף אחד מהערכים האלה בצ'אט** (גם לא אצלי), ולא ב-issue, ב-pull request, ב-commit או בקובץ ב-repo.
> המקום היחיד שלהם הוא GitHub Secrets (ומנהל הסיסמאות שלך). אם ערך נחשף בטעות – לבטל אותו מיד (סעיף 5).

## הסודות הנדרשים

| שם הסוד ב-GitHub (בדיוק כך) | מה הוא | איפה משיגים |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal access token של חשבון Supabase | סעיף 1 |
| `SUPABASE_STAGING_DB_PASSWORD` | סיסמת מסד הנתונים של `hkmanager-staging` | סעיף 2 |
| `SUPABASE_PROD_DB_PASSWORD` | סיסמת מסד הנתונים של `hkmanager-prod` | סעיף 2 |
| `GOOGLE_DRIVE_BACKUP_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` | הגיבוי השבועי ל-Google Drive (M7.3) | `docs/setup/backups.md` |

מזהי הפרויקטים (`tmistmqyqcnjftovxyoy` ל-staging, `gnjdyiujvxbwhxmldgfn` ל-production) אינם סודיים וכבר כתובים בקובצי ה-workflow.

## 1. יצירת Personal access token ב-Supabase
1. להיכנס ל-https://supabase.com/dashboard עם החשבון שמחזיק את שני הפרויקטים.
2. תפריט החשבון (למעלה) → **Account preferences** → **Access Tokens** (כתובת ישירה: https://supabase.com/dashboard/account/tokens).
3. **Generate new token**. שם: `hkmanager-github-actions`.
   - אם מוצעת בחירת תוקף (expiry) – לבחור תוקף, ולרשום ביומן תזכורת לחדש אותו לפני שיפוג. כשהטוקן פג, ה-workflows ייכשלו עם שגיאת הרשאה עד שיוגדר טוקן חדש.
   - אם מוצעת בחירת הרשאות (scoped token) – לפי ה-CLI נדרשות: `projects_read`, `project_admin_read`, `database_pooling_config_read`. ההרשאה `database_write` כנראה אינה נדרשת, כי סיסמת ה-DB מועברת ל-CLI דרך `SUPABASE_DB_PASSWORD`; היא נדרשת רק לחיבור בלי סיסמה. האפשרות הבטוחה היא לכלול גם אותה; אם משמיטים אותה וה-workflow נכשל בשגיאת הרשאה – להוסיף אותה. אם אין בחירה כזו – הטוקן מקבל גישה לכל הפרויקטים בחשבון, ולכן יש לשמור עליו כמו על סיסמה.
4. להעתיק את הטוקן. **הוא מוצג פעם אחת בלבד.** להדביק אותו ישר ב-GitHub (סעיף 3), ולא לשמור אותו בקובץ.

## 2. סיסמת מסד הנתונים של כל פרויקט
את הסיסמאות יצרת בעת פתיחת הפרויקטים (`docs/setup/supabase-accounts.md`, סעיף 3) ושמרת במנהל הסיסמאות. לכל פרויקט סיסמה אחרת.

Supabase אינו מציג סיסמה קיימת. אם הסיסמה אבדה – יש לאפס אותה, לכל פרויקט בנפרד:
1. לפתוח את הפרויקט (`hkmanager-staging` או `hkmanager-prod`).
2. **Project Settings → Database** → **Reset database password**.
3. **Generate a password**, לשמור את הסיסמה החדשה במנהל הסיסמאות, ואז לאשר.
4. לעדכן את הסוד המתאים ב-GitHub (סעיף 3).

איפוס הסיסמה מנתק כל חיבור שמשתמש בסיסמה הישנה. כרגע רק ה-workflow משתמש בה, כך שאין השפעה על האפליקציה (היא מתחברת עם מפתחות ה-API, לא עם סיסמת ה-DB).

## 3. הוספת הסודות ב-GitHub
1. לפתוח את ה-repository ב-GitHub → **Settings** → **Secrets and variables** → **Actions**.
2. בלשונית **Secrets** → **New repository secret**.
3. Name: השם מהטבלה למעלה, בדיוק (אותיות גדולות וקווים תחתונים). Secret: הערך. **Add secret**.
4. לחזור על כך לשלושת הסודות.

GitHub לא מציג ערך של סוד אחרי השמירה, ומסתיר אותו בלוגים. כדי להחליף ערך – **Update** על הסוד הקיים.

## 4. בדיקה שהכול עובד
- **Staging:** אחרי merge (או push) ל-`main`, רץ קודם ה-workflow **CI**. רק אם הוא עבר, רץ **Staging migrations** ומחיל את ה-migrations על staging. רואים את זה בלשונית **Actions** של ה-repo.
- **Production:** ידני בלבד. **Actions → Production migrations → Run workflow**, לבחור את הענף `main` → **Run workflow**.
  ה-workflow מסרב לרוץ אם לא קיימת ריצה מוצלחת של Staging migrations לאותו commit בדיוק (SPEC 0.5: staging לפני production). אם הוא נכשל בשלב הזה – לחכות שה-CI וה-staging יסתיימו בהצלחה ל-commit האחרון ב-`main`, ולהריץ שוב.
- אם סוד חסר, הריצה נכשלת עם הודעה שמציינת את שם הסוד החסר.

## 5. אם סוד נחשף
- **Access token:** למחוק אותו ב-Supabase (Access Tokens → Revoke), ליצור חדש (סעיף 1) ולעדכן ב-GitHub.
- **סיסמת DB:** לאפס אותה (סעיף 2) ולעדכן ב-GitHub.

## מה ה-workflows עושים ומה לא
- הם מריצים רק את קובצי ה-SQL שב-`supabase/migrations/` שעדיין לא הוחלו על הפרויקט (`supabase db push`). Supabase שומר בפרויקט טבלת היסטוריה של migrations, כך ש-migration שכבר הוחל לא ירוץ שוב.
- הם **אינם** מעדכנים את הגדרות ה-Auth שב-`supabase/config.toml` (ה-hook, ספקי הכניסה, כתובות ה-redirect). אלה נשארים ידניים בדשבורד, לפי `docs/setup/supabase-auth.md`. אחרי שה-migrations הוחלו על פרויקט, אפשר להמשיך שם משלב 2.
- הם **אינם** מריצים את `supabase/seed.sql` ואינם מכניסים כתובות ל-allowlist.
- אין להריץ migrations ידנית ב-SQL Editor של staging או production: הן לא יירשמו בטבלת ההיסטוריה, וה-workflow ינסה להריץ אותן שוב וייכשל. אם כבר הורצו migrations ידנית באחד הפרויקטים – לעדכן אותי לפני הריצה הראשונה.

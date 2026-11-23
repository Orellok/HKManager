# פריסה ל-Netlify – staging ו-production (M0.6)

מטרה: להפעיל את הפריסה האוטומטית ל-staging ואת הפריסה הידנית ל-production מ-GitHub Actions.
תנאי מוקדם: חשבון Netlify ושני אתרים לפי `docs/setup/netlify.md` (סעיפים 1–4), והסודות של ה-migrations לפי `docs/setup/github-secrets.md`.
זמן משוער: 30–40 דקות. הממשקים משתנים מדי פעם; אם מסך נראה אחרת – לפעול לפי המשמעות.

> **אין להדביק בצ'אט** את הטוקן של Netlify או מפתח כלשהו של Supabase. ה-Site IDs והכתובות אינם סודיים.

## איך זה עובד
- **Staging – אוטומטי:** push/merge ל-`main` ← **CI** ← **Staging migrations** ← **Staging deploy**. הפריסה רצה רק אם ה-migrations הוחלו בהצלחה על אותו commit, ורק אם הוא עדיין ה-commit האחרון ב-`main`.
- **Production – ידני:** קודם **Production migrations**, ואחר כך **Production deploy**. ה-workflow מסרב לרוץ אם לאותו commit בדיוק אין פריסת staging מוצלחת **ו**ריצת production migrations מוצלחת.
- בכל פריסה: בנייה ב-GitHub Actions ← העלאה כ-**draft** (האתר החי לא משתנה) ← **בדיקת smoke** על ה-draft ← פרסום לאתר החי ← בדיקת smoke חוזרת על האתר החי. אם בדיקת ה-smoke על ה-draft נכשלת – האתר החי נשאר כמו שהיה.
- Netlify **אינו** מחובר ל-repo, ולכן אין deploy previews ואין פריסות שצורכות credits בלי שביקשנו.

## 1. משתנים וסוד ב-GitHub
ב-GitHub: **Settings → Secrets and variables → Actions**.

**לשונית Secrets** (כבר הוגדר לפי `docs/setup/netlify.md` סעיף 4):

| שם (בדיוק כך) | ערך |
|---|---|
| `NETLIFY_AUTH_TOKEN` | ה-Personal access token של Netlify |

**לשונית Variables → New repository variable** – שישה משתנים:

| שם (בדיוק כך) | ערך | איפה משיגים |
|---|---|---|
| `NETLIFY_STAGING_SITE_ID` | ה-Site ID של `hkmanager-staging` | Netlify → האתר → Site configuration → General → Site details → Site ID |
| `NETLIFY_PRODUCTION_SITE_ID` | ה-Site ID של `hkmanager` | כנ"ל, באתר ה-production |
| `STAGING_NEXT_PUBLIC_SUPABASE_URL` | `https://tmistmqyqcnjftovxyoy.supabase.co` | בדיוק הערך הזה |
| `STAGING_NEXT_PUBLIC_SUPABASE_ANON_KEY` | המפתח הציבורי של `hkmanager-staging` | Supabase → הפרויקט → Project Settings → API Keys: המפתח `anon` `public` (או ה-Publishable key) |
| `PRODUCTION_NEXT_PUBLIC_SUPABASE_URL` | `https://gnjdyiujvxbwhxmldgfn.supabase.co` | בדיוק הערך הזה |
| `PRODUCTION_NEXT_PUBLIC_SUPABASE_ANON_KEY` | המפתח הציבורי של `hkmanager-prod` | כנ"ל, בפרויקט ה-production |

- **רק המפתח הציבורי** (`anon` / Publishable). **לעולם לא** `service_role` או Secret key: המפתח נבנה לתוך הקוד שנשלח לדפדפן. ה-workflow בודק זאת ונכשל אם הוזן מפתח אחר.
- ה-workflow בודק גם שכתובת ה-Supabase של כל סביבה היא של הפרויקט הנכון, כדי ש-staging לא ייבנה בטעות מול production.
- **אין להגדיר משתני סביבה בממשק של Netlify.** הערכים נבנים לתוך האפליקציה ב-GitHub Actions.
- אם ערך חסר או שגוי, הריצה נכשלת עם הודעה שמציינת את **שם** המשתנה (לא את ערכו).

## 2. Supabase – URL Configuration
בכל פרויקט: **Authentication → URL Configuration**:

| פרויקט | Site URL | Redirect URLs |
|---|---|---|
| `hkmanager-staging` | `https://hkmanager-staging.netlify.app` | `https://hkmanager-staging.netlify.app/auth/callback` |
| `hkmanager-prod` | `https://hkmanager.netlify.app` | `https://hkmanager.netlify.app/auth/callback` |

- אם שמות האתרים ב-Netlify יצאו שונים – להשתמש בכתובות בפועל, ולעדכן אותי.
- אין צורך להוסיף את כתובות ה-draft (`https://<מזהה>--hkmanager-staging.netlify.app`): בדיקת ה-smoke אינה מתחברת.
- אין להוסיף `localhost` לפרויקט production.
- שאר הגדרות ה-Auth (hook, ספקים) – לפי `docs/setup/supabase-auth.md`, אם עוד לא בוצעו.

## 3. Google OAuth – Authorized JavaScript origins
ב-Google Cloud → Clients (`docs/setup/google-oauth.md`):
- Client **`HKManager staging+local`**: להוסיף origin `https://hkmanager-staging.netlify.app`.
- Client **`HKManager production`**: לוודא שקיים origin `https://hkmanager.netlify.app`.
- ה-Redirect URIs (כתובות ה-callback של Supabase) נשארים ללא שינוי.

## 4. Allowlist
בכל פרויקט (staging ו-production), **לפני הכניסה הראשונה**: להכניס את שתי הכתובות האמיתיות ב-SQL Editor, לפי `README.md` ← "Allowlist". בלי זה ה-hook ידחה את הכניסה.

## 5. ריצה ראשונה
1. **Staging:** merge ל-`main` (או push). בלשונית **Actions** לוודא שרצו ועברו, בזה אחר זה: **CI**, **Staging migrations**, **Staging deploy**.
2. **Production:** **Actions → Production migrations → Run workflow** (ענף `main`). כשהסתיים בהצלחה: **Actions → Production deploy → Run workflow** (ענף `main`).
   - כל פריסת production דורשת ריצת Production migrations מוצלחת **לאותו commit**. כשאין migrations חדשים הריצה פשוט לא מחילה כלום – אבל עדיין צריך להריץ אותה לפני הפריסה.

## 6. בדיקות ידניות אחרי הפריסה הראשונה
סעיפים 1–2 בשתי הסביבות. סעיפים 3–4 ב-staging בלבד, עם נתוני בדיקה: ב-production הם יוצרים רשומות אמיתיות (קבלה מקבלת מספר רץ).
1. **כניסה עם Google** בחשבון שב-allowlist → "דף הבית", ובכותרת "יציאה". "יציאה" → חזרה למסך הכניסה.
2. **כניסה עם Google בחשבון שאינו ב-allowlist** → המסך "אין הרשאה".
3. **קבלה אחת ב-PDF:** לפתוח הכנסה, להפיק קבלה ולוודא שה-PDF נפתח.
4. **תמונת הוצאה אחת:** להוסיף הוצאה עם צילום מהטלפון, ולוודא שהתמונה נשמרת ונפתחת.
5. **Push:** לא עכשיו – ייבדק ב-M7.
6. **Netlify → Usage/Billing:** לבדוק כמה credits צרכה הפריסה הראשונה (כולל ה-draft), ולעדכן אותי (VERIFY-02).

## 7. אם בדיקת ה-smoke נכשלת
בלוג של השלב **Smoke check the draft deploy** מופיעה כל בדיקה עם PASS או FAIL.
- כשל ב-"redirected to /login by the proxy", ב-"nonce CSP" או ב-"prefetch" בפריסה הראשונה פירושו ש-`proxy.ts` לא רץ כמו שצריך ב-Netlify. **לעצור ולעדכן אותי** – זה שער VERIFY-02, ואין לעקוף אותו.
- האתר החי לא השתנה, ואין צורך לעשות דבר ב-Netlify.

## 8. אם הטוקן של Netlify נחשף או פג
למחוק אותו ב-Netlify (User settings → Applications → Personal access tokens), ליצור חדש לפי `docs/setup/netlify.md` סעיף 4, ולעדכן את הסוד `NETLIFY_AUTH_TOKEN` ב-GitHub.

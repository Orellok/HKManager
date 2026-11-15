# הגדרות Auth ב-Supabase – staging ו-production (M0.3)

פרויקטים מתארחים (hosted) **אינם קוראים** את `supabase/config.toml`. את מה שמוגדר שם מקומית יש להגדיר ידנית בדשבורד, לכל אחד משני הפרויקטים (`hkmanager-staging`, `hkmanager-prod`).
ממשק הדשבורד משתנה מדי פעם; אם מסך נראה אחרת – לפעול לפי המשמעות.

## סדר הפעולות
1. **Migrations:** להריץ את ה-migrations על הפרויקט (staging קודם, אחר כך production – SPEC 0.5). זה יוצר את `public.allowed_users` ואת הפונקציה `public.hook_before_user_created` עם ההרשאות הנכונות (EXECUTE רק ל-`supabase_auth_admin`). בלי הפונקציה – אין להפעיל את ה-hook (שלב 3).
2. **Allowlist:** להכניס את שתי הכתובות האמיתיות לפי README ("Allowlist"), ב-SQL Editor של הפרויקט. **לפני** הכניסה הראשונה עם Google – אחרת ה-hook ידחה את יצירת המשתמש.
3. **Before User Created hook:** Authentication → Hooks → *Before User Created* → Add hook:
   - Hook type: **Postgres**
   - Schema: `public`, Function: `hook_before_user_created`
   - Enable → Save.
   - אם הדשבורד מציע להריץ SQL של הרשאות – לא נדרש; ה-migration כבר נותן אותן.
4. **Sign In / Providers:**
   - **Allow new users to sign up: ON.** בלי זה Supabase דוחה גם את הכניסה הראשונה של משתמש מורשה עם Google. מי שמותר להיווצר נקבע ע"י ה-hook (רק חשבון Google שב-allowlist).
   - **Email: OFF** (Disable). ה-hook דוחה ממילא הרשמה עם מייל וסיסמה; כיבוי הספק מסיר גם את הכניסה בסיסמה. משתמשי בדיקה עם סיסמה קיימים רק בסביבה המקומית.
   - **Anonymous sign-ins: OFF.** Phone: OFF.
   - **Google: Enable**, עם ה-Client ID וה-Secret של ה-client המתאים (docs/setup/google-oauth.md, סעיף 5).
5. **URL Configuration** (Authentication → URL Configuration):

   | | Site URL | Redirect URLs |
   |---|---|---|
   | production | `https://hkmanager.netlify.app` | `https://hkmanager.netlify.app/auth/callback` |
   | staging | כתובת ה-staging של Netlify (ייקבע ב-M0.4) | `<staging URL>/auth/callback` (וכתובות deploy previews אם יוחלט עליהן ב-M0.4) |

   כתובת ה-production כפופה ל-VERIFY-02. אין להוסיף `localhost` לפרויקט production.
6. **משתני סביבה ב-Netlify (M0.4):** `NEXT_PUBLIC_SUPABASE_URL` ו-`NEXT_PUBLIC_SUPABASE_ANON_KEY` של הפרויקט המתאים. ה-service role key אינו נדרש לאפליקציה בשלב זה.

## בדיקה ידנית אחרי ההגדרה (לכל סביבה)
1. כניסה עם חשבון Google שב-allowlist → מגיעים ל"דף הבית", ובכותרת מופיע "יציאה".
2. "יציאה" → חוזרים למסך הכניסה.
3. כניסה עם חשבון Google שאינו ב-allowlist → חוזרים למסך הכניסה עם ההודעה "הכניסה לא הושלמה…". ב-Authentication → Users לא נוצר משתמש חדש.

## מקומי
`supabase/config.toml` כבר מגדיר את כל זה. לכניסה אמיתית עם Google מקומית יש להגדיר `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` ו-`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` (ראו `.env.example`) ולהפעיל מחדש את `pnpm db:start`.

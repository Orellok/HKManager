# הוראות פתיחה – Google OAuth לכניסה (M0.3)

מטרה: שני OAuth clients לכניסה עם Google – אחד ל-**staging + פיתוח מקומי**, ואחד ל-**production** (SPEC 7: "OAuth client נפרד ל-staging").
זמן משוער: 20–30 דקות. ממשק Google Cloud משתנה מדי פעם (השמות "OAuth consent screen" / "Google Auth Platform"); אם מסך נראה אחרת – לפעול לפי המשמעות.

> הלקוח הזה משמש **לכניסה בלבד** (scopes בסיסיים: `openid`, `email`, `profile`). הרשאת היומן (M5) מבוקשת בנפרד ותלויה ב-VERIFY-03. הגיבוי ל-Drive (M7) ישתמש ב-client נפרד נוסף (SPEC 8).

## 1. פרויקט ב-Google Cloud
1. להיכנס ל-https://console.cloud.google.com עם חשבון ה-Google של ה-admin (מנהל טכני).
2. ליצור פרויקט חדש: `HKManager`.

## 2. מסך הסכמה (Consent screen / Google Auth Platform)
1. **Branding:** App name `HKManager`; support email ו-developer contact – המייל של ה-admin. לא להעלות לוגו (לוגו מחייב אימות מותג).
2. **Audience:** User type = **External**.
3. **Test users:** להוסיף את שתי כתובות ה-Gmail של המשתמשים (שלך ושל בעלת העסק).
4. **Data access / Scopes:** רק `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
5. סטטוס פרסום: להשאיר **Testing** בשלב זה. ההחלטה על מעבר ל-Production תיבחן יחד עם VERIFY-03 לפני M5 – אין לשנות לפני כן.

## 3. Client ל-staging + מקומי
**Clients → Create client → Web application**, שם: `HKManager staging+local`.
- Authorized redirect URIs:
  - `https://tmistmqyqcnjftovxyoy.supabase.co/auth/v1/callback`
  - `http://127.0.0.1:54321/auth/v1/callback`
- Authorized JavaScript origins: `http://localhost:3000` (כתובת ה-staging של Netlify תתווסף ב-M0.4).

## 4. Client ל-production
שם: `HKManager production`.
- Authorized redirect URIs: `https://gnjdyiujvxbwhxmldgfn.supabase.co/auth/v1/callback`
- Authorized JavaScript origins: `https://hkmanager.netlify.app` (בכפוף לזמינות השם – VERIFY-02; אם יתברר שונה, נעדכן).

## 5. הזנת הפרטים ב-Supabase (אתה מזין ישירות – לא בצ'אט)
לכל אחד משני הפרויקטים ב-Supabase: **Authentication → Sign In / Providers → Google → Enable**, ולהדביק את ה-Client ID וה-Client Secret של ה-client המתאים:
- `hkmanager-staging` ← client "staging+local"
- `hkmanager-prod` ← client "production"

**את ה-Client Secret לא שולחים בצ'אט.** עבור פיתוח מקומי, כשנצטרך, אבקש אותו דרך טופס מאובטח של הסשן.

## 6. מה לעשות עכשיו ומה אחר כך
- עכשיו: סעיפים 1–5.
- אחר כך (ההנחיות יגיעו עם סיום M0.3): הפעלת ה-auth hook שחוסם יצירת משתמשים שאינם ב-allowlist, הגדרת Site URL ו-Redirect URLs ב-Supabase, והזנת שתי כתובות ה-allowlist האמיתיות בכל סביבה.

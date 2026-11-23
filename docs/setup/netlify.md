# הוראות פתיחה – Netlify (לקראת M0.6)

מטרה: חשבון Netlify חינמי ושני אתרים – staging ו-production. **הפריסה עצמה תתבצע מ-GitHub Actions** (רק אחרי שה-CI עבר, כפי שהאפיון מחייב), ולכן **לא** מחברים את Netlify ישירות ל-repo.
זמן משוער: 15 דקות. הממשק עשוי להשתנות; אם מסך נראה אחרת – לפעול לפי המשמעות.

## 1. חשבון
1. להירשם ב-https://app.netlify.com/signup – מומלץ עם חשבון GitHub.
2. תוכנית: **Free**. לא להזין אמצעי תשלום.
3. להפעיל אימות דו-שלבי (User settings → Security).
4. **לבדוק בדף ה-Billing/Usage של החשבון** אם הוא במודל credits (בערך 300 בחודש) או במודל הישן (מכסות נפרדות), ולעדכן אותי. במודל credits האתר **נעצר** כשהמכסה נגמרת – זה משפיע על תדירות הפריסות שנתכנן.

## 2. יצירת שני אתרים בלי חיבור ל-Git
לכל אחד: **Add new site → Deploy manually** (גרירת תיקייה ריקה כלשהי מספיקה ליצירה), ואז **Site configuration → Change site name**:

| אתר | שם מבוקש | כתובת |
|---|---|---|
| production | `hkmanager` | `https://hkmanager.netlify.app` |
| staging | `hkmanager-staging` | `https://hkmanager-staging.netlify.app` |

- **אם `hkmanager` תפוס – לעצור ולעדכן אותי** (SPEC 3, VERIFY-02). לא לבחור שם אחר לבד.
- אין צורך להגדיר Build settings – הבנייה תתבצע ב-GitHub Actions.

## 3. מה להעביר לי (לא סודי)
- ה-**Site ID** של כל אתר: Site configuration → General → Site details → Site ID.
- את הכתובות הסופיות של שני האתרים.

## 4. סוד אחד ב-GitHub (לא בצ'אט)
1. ב-Netlify: User settings → Applications → **Personal access tokens → New access token**. שם: `HKManager GitHub Actions`. תוקף: הארוך ביותר שמוצע, ולרשום תזכורת לחידוש.
2. ב-GitHub: Settings → Secrets and variables → Actions → New repository secret: שם `NETLIFY_AUTH_TOKEN`, ערך – הטוקן.
3. **לא להדביק את הטוקן בצ'אט.**

## 5. השלב הבא
הגדרת הפריסה עצמה (משתנים ב-GitHub, כתובות ב-Supabase וב-Google, ובדיקות אחרי הפריסה הראשונה): `docs/setup/deploy.md`.

# הוראות פתיחה – Supabase (staging + production)

מטרה: שני פרויקטים חינמיים ב-Supabase – אחד ל-staging ואחד ל-production (SPEC סעיפים 3, 7).
זמן משוער: 15–20 דקות. הנחיות הממשק עשויות להשתנות מעט; אם מסך נראה אחרת – לפעול לפי המשמעות.

## 1. פתיחת חשבון
1. להיכנס ל-https://supabase.com ולבחור **Start your project**.
2. להירשם עם חשבון GitHub (מומלץ – אותו חשבון שמחזיק את ה-repo) או עם מייל.
3. **להפעיל אימות דו-שלבי (2FA)** בהגדרות החשבון. בחשבון הזה יישב מידע אישי של לקוחות.

## 2. ארגון (Organization)
1. ליצור Organization בשם `HKManager`.
2. סוג: Personal. תוכנית: **Free**. לא להזין אמצעי תשלום.

## 3. יצירת שני פרויקטים
לכל אחד מהשניים – **New project**:

| שדה | staging | production |
|---|---|---|
| Name | `hkmanager-staging` | `hkmanager-prod` |
| Database password | **Generate** – לשמור במנהל סיסמאות | **Generate** – לשמור במנהל סיסמאות (סיסמה אחרת) |
| Region | האזור האירופי הקרוב (למשל Central EU – Frankfurt). שניהם באותו אזור | זהה ל-staging |

- יצירת פרויקט לוקחת כ-2 דקות.
- **אין לשלוח לי** את סיסמת ה-DB או את ה-service role / secret key בצ'אט.

## 4. מה להעביר לי
מכל פרויקט: **Project Settings → General → Project ID (ref)**, וכן כתובת ה-Project URL (`https://<ref>.supabase.co`).
אלה אינם סודיים. את המפתחות הסודיים נגדיר בהמשך ישירות ב-GitHub Secrets / Netlify, או דרך טופס מאובטח של הסשן – לא בצ'אט.

## 5. מה לא לעשות עכשיו
- לא להפעיל Google Auth – יש לכך הוראות נפרדות ב-M0.3 (כולל OAuth client נפרד ל-staging, SPEC 7).
- לא ליצור טבלאות ידנית – כל הסכימה נוצרת מ-migrations בלבד (SPEC 0.5).
- לא להכניס נתוני אמת ל-staging (SPEC 7).

## 6. נקודות לאימות (VERIFY-01)
- **עצירת פרויקט לא פעיל:** לפי ה-FAQ הרשמי של Supabase, פרויקט Free עם פעילות DB נמוכה במשך שבוע מושהה, ונדרש שחרור ידני מה-Dashboard. לכן ה-cron השבועי יכלול keep-alive לשני הפרויקטים (SPEC 8). מקור: https://supabase.com/kb/faqs/platform/free-project-pausing
- **מספר פרויקטים חינמיים, מגבלות DB/Storage וגיבויים ב-Free:** לא הצלחתי לאמת מתוך הסביבה (supabase.com חסום ברשת של הסשן). לפי מקורות צד שלישי אין גיבויים אוטומטיים ב-Free – הגיבוי השבועי שלנו (SPEC 8) מכסה זאת. **נא לבדוק בדף https://supabase.com/pricing שתוכנית Free מאפשרת 2 פרויקטים פעילים**, ולעדכן אותי.

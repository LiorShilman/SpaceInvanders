# Invaders: Nexus

Space Invaders מחדש: תלת-ממדי, מולטיפלייר, בדפדפן. תוכנית הפיתוח המלאה נמצאת ב-[`docs/GAME_PLAN.md`](./docs/GAME_PLAN.md) (וב-[`docs/game-plan.html`](./docs/game-plan.html) לגרסה המעוצבת).

## מצב נוכחי: Phase 0 — משחק סינגלפלייר אינסופי

גלים מסלימים ללא הגבלה (כל גל שנבלם מוליד גל קשה יותר), 40 אויבים בפיזור אורגני, 4 מגני הגנה הרסים, מודלים תלת-ממדיים מפורטים, ומצב תלת-ממד אנאגליפי אמיתי (מקש 3). אין עדיין רשת/מולטיפלייר (זה Phase 1).

## הרצה

```bash
npm install
npm run dev
```

יפתח שרת פיתוח בכתובת http://localhost:5173.

**שליטה:** WASD / חצים לתנועה, רווח לירי, 3 להחלפת מצב תלת-ממד (משקפי אדום-כחול).

## מבנה הריפו

```
client/    Vite + React Three Fiber — כל הלוגיקה הנוכחית של המשחק
server/    שרת Colyseus (ייבנה ב-Phase 1)
shared/    טיפוסים משותפים ל-client ו-server (Phase 1+)
docs/      תוכנית המשחק המלאה
```

ראו [`docs/GAME_PLAN.md`](./docs/GAME_PLAN.md) למפת הדרכים המלאה.

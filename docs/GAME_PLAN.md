# Invaders: Nexus — Game Plan

תוכנית הפיתוח המלאה (חזון, ארכיטקטורה, שפה חזותית, מפת דרכים) נמצאת ב:

- **גרסה מעוצבת (HTML):** [`docs/game-plan.html`](./game-plan.html) — פתחו בדפדפן מקומית
- **גרסה חיה מתעדכנת:** https://claude.ai/code/artifact/1c36d3c1-ba6d-4dd7-b015-771b1cc7f098

## תמצית

- **פלטפורמה:** דפדפן — Three.js + React Three Fiber, Vite
- **מולטיפלייר:** Colyseus, מתחילים ב-Co-op הישרדותי ובונים PvP א-סימטרי כשכבה שנייה
- **שפה חזותית:** פוספור ירוק על שחור (השראה ממסך ה-CRT המקורי של 1978), לא סינת'ווייב גנרי

## מפת דרכים

| שלב | שם | תוכן |
|---|---|---|
| 0 | Foundation | שלד מונורפו, לולאת סינגלפלייר, HUD בסיסי |
| 1 | Co-op Network | שרת Colyseus, 2-4 שחקנים, revive |
| 2 | Content & Bosses | גלים פרוצדורליים, בוסים, ליטוש חזותי |
| 3 | Asymmetric PvP | מצב "מפקד פולשים" מול מגינים |
| 4 | Launch Polish | leaderboard, סקינים, פריסה לשרת הבית |

**מצב נוכחי:** Phase 0 בבנייה — ראו [`client/`](../client) ללולאת המשחק.

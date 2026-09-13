# server (Phase 1)

שרת Colyseus סמכותי (authoritative) — עדיין לא מומש. נבנה בכניסה ל-**Phase 1: Co-op Network** (ראו [`../docs/GAME_PLAN.md`](../docs/GAME_PLAN.md)).

צפוי להכיל:
- `src/rooms/co-op-survival.ts` — חדר ההישרדות המשותפת
- `src/rooms/pvp-asymmetric.ts` — חדר ה-PvP (Phase 3)
- `src/sim/` — סכימת מצב המשחק המשותפת (server-authoritative state)
- `src/waves/` — מחולל הגלים הפרוצדורלי

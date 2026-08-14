# WhatsApp — first announcement (Hebrew + English)

**Channel:** WhatsApp dev groups (IL + international)
**Updated:** 2026-08-07 — bookmark-led variant (0.44.15 is now npm @latest, so bookmarks lead)
**Rules applied:** honest positioning per `11_POSITIONING_v2.md` — no "only tool" claims. Apex redirect on Vercel is fixed, but keep `www.` as the canonical link.

---

## עברית — גרסה מלאה (bookmark-led)

🔥 **infernoflow — זיכרון קבוע ל-AI שלכם, עכשיו עם Session Bookmarks**

מי שעובד עם Cursor / Claude Code / Copilot מכיר את זה: כל צ'אט חדש מתחיל מאפס. ה-AI שוכח את הבאגים שכבר פתרתם, את ההחלטות שקיבלתם, ואת מה שכבר ניסיתם ולא עבד — ואתם מסבירים הכול מחדש.

בניתי כלי open-source שסוגר את הפער:

🔖 **חדש — Session Bookmarks:** אומרים "bookmark this" באמצע סשן, ובפעם הבאה ממשיכים בדיוק מאיפה שעצרתם. ב-Claude Code זה אפילו קורא את ה-transcript מהדיסק ומזקק אותו אוטומטית — בלי קריאות AI, דטרמיניסטי לגמרי.
✅ תופס gotchas והחלטות תוך כדי עבודה — ה-AI עצמו מתעד אותם (MCP)
✅ הסשן הבא מתחיל חם — הזיכרון מוזרק אוטומטית לקבצי ה-rules שה-IDE כבר קורא
✅ הזיכרון עובר עם ה-branch בגיט — חבר צוות שעושה checkout יורש את הידע שלכם
✅ לוקאלי לגמרי — JSONL על הדיסק. בלי ענן, בלי טלמטריה, בלי תלות בספק. MIT.

התקנה בשתי שורות:
```
npm install -g infernoflow
infernoflow init --yes
```

⭐ https://www.infernoflow.dev

אשמח לפידבק — טוב או רע, הכול עוזר 🙏

---

## עברית — גרסה קצרה (לקבוצות עם כללים נוקשים)

🔥 בניתי כלי open-source שנותן ל-Cursor / Claude Code / Copilot זיכרון קבוע בין סשנים. חדש: 🔖 Session Bookmarks — אומרים "bookmark this" וממשיכים בפעם הבאה בדיוק מאיפה שעצרתם. gotchas, החלטות ודברים שכבר ניסיתם נשמרים מקומית (JSONL, git) ומוזרקים אוטומטית לצ'אט הבא. בלי ענן, בלי טלמטריה, MIT.

`npm i -g infernoflow && infernoflow init --yes`
https://www.infernoflow.dev — אשמח לפידבק 🙏

---

## English — full version (bookmark-led)

🔥 **infernoflow — persistent memory for your AI coding sessions, now with Session Bookmarks**

If you work with Cursor / Claude Code / Copilot, you know the drill: every new chat starts cold. The AI forgets the bugs you already fixed, the decisions you made, and the dead ends you already tried — so you re-explain everything.

I built an open-source tool that closes that loop:

🔖 **New — Session Bookmarks:** say "bookmark this" mid-session and resume exactly where you left off next time. On Claude Code it even reads the on-disk transcript and distills it automatically — no AI calls, fully deterministic.
✅ Captures gotchas & decisions as you work — the AI logs them itself (via MCP)
✅ Next session starts warm — memory is auto-injected into the rule files your IDE already reads
✅ Memory travels with your git branch — a teammate who checks it out inherits your findings
✅ Fully local — JSONL on disk. No cloud, no telemetry, no vendor lock-in. MIT.

Two-line install:
```
npm install -g infernoflow
infernoflow init --yes
```

⭐ https://www.infernoflow.dev

Feedback very welcome — good or bad, it all helps 🙏

---

## English — short version

🔥 I built an open-source tool that gives Cursor / Claude Code / Copilot persistent memory across sessions. New: 🔖 Session Bookmarks — say "bookmark this" and resume exactly where you left off next session. Gotchas, decisions and failed attempts are stored locally (JSONL, git-tracked) and auto-injected into your next chat. No cloud, no telemetry, MIT.

`npm i -g infernoflow && infernoflow init --yes`
https://www.infernoflow.dev — feedback welcome 🙏

---

## Posting notes

- One post per group; don't cross-post the same text to overlapping groups the same hour.
- Answer every reply within the first hour — replies drive WhatsApp's "unread jump" and group attention.
- Lead with the full version in engaged groups; use the short version where rules are strict.
- Track: npm downloads the day after posting vs. 10–30/day baseline (`npm view infernoflow`).

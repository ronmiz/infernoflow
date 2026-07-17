# Screencast 2 — "Cold → Warm" (the token/session amnesia film)

**Concept:** A developer's session ends (context window fills / usage limit hit). They open the next session and it's **cold** — the AI knows nothing, they have to re-explain everything. Then infernoflow **warms it up** — the new session opens already knowing the gotchas and where they left off. The whole film is a temperature metaphor: cold blue → warm orange. On brand: infernoflow = fire = warmth.

**Why this works:** it literally animates the tagline *"Every new AI session starts cold. infernoflow makes them stick."* No claim to fact-check — it's a feeling, and the feeling is true.

---

## The honesty guardrail (read before scripting)

Sessions don't literally "run out of tokens and freeze." Keep the trigger **relatable but accurate** so a skeptic can't nitpick:
- ✅ "Context window's full — start a new chat" / "New session"
- ✅ Usage limit reached → tomorrow you're in a fresh session
- ❌ Don't imply infernoflow gives the AI more tokens or a bigger context window. It doesn't. It **re-seeds the new session with the memory that matters.**

The warm payoff must show a **real** recall (use a true dogfood gotcha): the Prisma DLL-lock or the Vite proxy Host-header trap. Both are real entries from infernotest_01.

---

## Two cuts (make both from one recording)

| Cut | Length | Sound | Where |
|---|---|---|---|
| **A — social loop** | 8–15s | **Silent + captions + music** | Twitter/X, Reddit, HN, WhatsApp, LinkedIn |
| **B — story film** | 45–60s | **Voice-over (קריינות) + music** | YouTube, homepage hero, dev.to cover, Product Hunt |

**On narration — my honest take:** put it ONLY in Cut B. ~85% of social video autoplays **muted**, so on Twitter/Reddit/HN narration is wasted breath — captions carry it. Cut A stays silent, big on-screen text, one satisfying "it remembered" beat. Cut B is the founder story where a calm, first-person voice-over shines. One recording, two exports.

---

## The temperature device (the core visual trick — cheap to do)

You do NOT need an actor or a set. The **terminal/editor itself** is the character. Grade the same screen recording two ways:

- **COLD state:** desaturate, push toward blue `#5B8DEF` / cyan; add a subtle frost vignette on the screen edges; slow the motion slightly; thin "breath fog" drifting up; UI sounds get a faint icy reverb (Cut B only).
- **WARM state:** the infernoflow orange `#FF6B35` / amber `#F7931E` glow blooms from the terminal prompt outward; frost melts (reverse the vignette); a soft ember-flicker; motion returns to normal speed; warm low hum.

The **transition** — cold→warm — is the money shot. One `infernoflow` line runs, and the color temperature of the entire frame swings from blue to orange over ~1 second.

---

## Cut B — shot-by-shot (45–60s, narrated)

**VO is written in both languages.** Record the Hebrew for IL groups + a native homepage; the English for HN/Reddit/global. Keep delivery calm and dry, not hype-y.

### 0:00–0:06 — Late-night flow (NEUTRAL grade)
- **Visual:** editor + terminal, dark theme. Code mid-edit. A context/usage indicator ticking toward full. Clock says late.
- **On-screen text (both cuts):** `11:47 PM. Deep in it.`
- **VO (HE):** "אחת עשרה וחצי בלילה. אתה עמוק בתוך זה. ה-AI סוף סוף מבין את הפרויקט שלך."
- **VO (EN):** "11:47 PM. You're deep in it. The AI finally gets your project."

### 0:06–0:14 — The freeze (grade slides to COLD)
- **Visual:** banner: *"Context window full — start a new chat."* The AI's last reply fades. Frost creeps in from the screen edges. Color drains to blue. Breath-fog.
- **On-screen text:** `Session over. Everything it learned — gone.`
- **VO (HE):** "ואז — נגמר החלון. סשן חדש. וכל מה שהוא למד עליך... נעלם."
- **VO (EN):** "Then the window fills up. New session. And everything it learned about you… gone."

### 0:14–0:24 — Cold open (full COLD grade)
- **Visual:** blank new chat, icy blue. AI: *"Hi! How can I help you today?"* — asking like you've never met. Dev types the same explanation they gave yesterday; a little "again…" sigh beat.
- **On-screen text:** `Re-explaining. Re-deriving. Re-making yesterday's mistake.`
- **VO (HE):** "אתה פותח סשן חדש — והוא קר. לא מכיר אותך. אתה מסביר שוב את מה שכבר הסברת אתמול. ואז הוא עושה בדיוק את אותה טעות."
- **VO (EN):** "You open a new session — and it's cold. Doesn't know you. You re-explain what you already explained yesterday. Then it makes the exact same mistake."

### 0:24–0:27 — One line (the pivot)
- **Visual:** dev types in the terminal: `infernoflow init --yes` (or just opens the next session with infernoflow already installed). Beat of stillness.
- **On-screen text:** `One line.`
- **VO (HE):** "שורה אחת."
- **VO (EN):** "One line."

### 0:27–0:40 — Warm-up (COLD → WARM transition, the money shot)
- **Visual:** orange glow blooms from the prompt; frost melts; the whole frame swings blue→orange over ~1s. New session opens and the AI leads with a **real** recall:
  > 🔥 *"Welcome back — last session you were mid auth-rewrite. Heads up: Prisma 6 holds a DLL lock on `query_engine.dll` while `tsx watch` runs — stop the watcher before you migrate. Want me to do that first?"*
- **On-screen text:** `It never forgot. Because you never told it twice.`
- **VO (HE):** "והפעם הסשן החדש נפתח — חם. הוא כבר יודע איפה עצרת. הוא מזכיר לך את הבאג שדרס אותך לפני שלושה שבועות — בלי שאמרת לו מילה."
- **VO (EN):** "This time the new session opens warm. It already knows where you stopped. It warns you about the bug that bit you three weeks ago — without you saying a word."

### 0:40–0:52 — How (fast, warm)
- **Visual:** 3 quick beats, each ~2s: (1) AI calls `amp_write` mid-work → a gotcha logged; (2) `.ai-memory/…jsonl` on disk, git-tracked; (3) the same memory surfacing in Cursor, Claude Code, Copilot.
- **On-screen text:** `Captured as you work · JSONL on disk · every IDE, warm.`
- **VO (HE):** "ה-AI תופס את זה תוך כדי עבודה. נשמר אצלך על הדיסק, נוסע עם הגיט. וכל IDE — Cursor, Claude Code, Copilot — מתחיל חם."
- **VO (EN):** "The AI captures it as you work. Saved on your disk, travels with your git. And every IDE — Cursor, Claude Code, Copilot — starts warm."

### 0:52–0:60 — Logo card (full WARM)
- **Visual:** black → flame logo. Tagline. Install line. URL.
- **On-screen text:**
  `🔥 infernoflow`
  `Every new AI session starts cold. infernoflow makes them stick.`
  `npm i -g infernoflow   ·   infernoflow.dev`
- **VO (HE):** "אינפרנופלואו. כל סשן מתחיל קר — עד עכשיו."
- **VO (EN):** "infernoflow. Every session starts cold — until now."

---

## Cut A — the 8–15s silent social loop

Pull three beats from the same recording, captions only, loop-friendly:
1. **(0–3s)** COLD blank session, AI: *"Hi! How can I help?"* — caption: **"Every new session forgets you."**
2. **(3–8s)** cold→warm transition + the real Prisma recall — caption: **"infernoflow makes it remember."**
3. **(8–12s)** logo + `npm i -g infernoflow` — hard cut back to frame 1 so it loops.

No VO. Big type. One satisfying temperature swing. This is the one that travels.

---

## Production — how to actually make it (cheapest path first)

**Tier 1 (do this for launch, ~half a day):**
- Record the terminal/editor with **OBS** or **asciinema** (see `SHOT_LIST_screencast_1` for the real command sequence).
- Do the cold/warm grade + frost/glow overlays in **DaVinci Resolve (free)** or **CapCut (free)** — color-temperature keyframes are a built-in slider; frost = a blue vignette PNG overlay, glow = an orange radial at reduced opacity.
- Music: one track from Uppbeat/YouTube Audio Library — something that starts sparse/cold and blooms warm.
- Export: Cut A as GIF/MP4 (≤5MB, muted-friendly) + Cut B as 1080p MP4.

**Tier 2 (post-launch polish):** add the "breath fog" particle, an animated ember, and record the VO (a calm read on a decent USB mic; or a natural-sounding TTS for a v1).

**Voice-over recording note:** keep it under ~90 words per language so it fits 60s at a calm pace. Record HE and EN as separate audio tracks over the same visual timeline.

---

## What I need from you to lock it
1. Real screen recording of a cold session vs. a warm (infernoflow) session — or approve me writing the exact OBS/asciinema command script so you just hit record.
2. Which real gotcha for the payoff — Prisma DLL-lock (default) or the Vite proxy one.
3. HE-first or EN-first for the voice-over.

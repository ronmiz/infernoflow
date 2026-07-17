# Veo 3.1 — prompt pack for the "Cold → Warm" film

**Goal:** spend as little as possible. Generate **only 4 atmosphere clips** with Veo (8s each). Everything with a terminal, code, or the real recall = **free screen recording**, composited in later. Veo is bad at legible UI/text and would waste your credits on garbled retries — so we explicitly tell it *not* to render screens.

## Cost-saving rules
- Generate each clip in Veo's **fast / draft mode first** to check framing, only final-render the keeper. Budget ~2–3 tries per clip.
- 4 clips × 8s is the whole AI spend. That's it.
- All prompts include a **negative prompt** blocking text/code/UI so Veo stays purely atmospheric (cheaper, and avoids the fake-terminal problem).
- Brand palette to keep it one system: **cold** `#5B8DEF` (blue) / `#8FB4FF` (icy) → **warm** `#FF6B35` (fire orange) / `#F7931E` (amber) / `#FFAB00` (gold). Near-black base `#0d0f16`.
- Aspect: **16:9** for YouTube/homepage. Also export a 9:16 crop for Reels/Shorts from the same clips.

---

## 🎬 AI CLIP 1 — Establishing: late-night flow (neutral, faintly warm)

```
A lone software developer sits at a dark home desk late at night, seen from behind
and slightly to the side, their face lit only by the soft glow of computer monitors.
Steam rises gently from a coffee mug. The room is quiet and intimate. Subtle dust
particles drift through the monitor light. The developer is calm, focused, in flow.
Cinematic, shallow depth of field, photoreal.

Camera: slow push-in from behind the shoulder, very gentle dolly forward.
Lighting: low-key, single warm-neutral key from the screens, deep shadows.
Color: near-black background #0d0f16, faint warm amber screen glow, neutral skin tones.
Mood: intimate, late-night focus, the quiet before something breaks.
Audio: soft room tone, faint keyboard clicks, a low ambient hum. No music.
Duration: 8 seconds.

Negative prompt: no readable text, no code, no user interface, no legible screen
content, no logos, no captions, no on-screen writing, no glitches.
```

---

## 🎬 AI CLIP 2 — The freeze: cold descends (the core "cold" beat)

```
The same dark desk and developer, now the atmosphere turns cold. The color
temperature of the whole room drains from neutral to icy blue. Delicate frost
crystals slowly creep inward from the edges of the frame. The developer's breath
becomes faintly visible as pale fog in the cold air. Motion slows, almost frozen.
A sense of everything going still and being lost. Cinematic, photoreal, moody.

Camera: locked static shot, almost imperceptible slow zoom-in, holding the stillness.
Lighting: cold blue rim light, falling brightness, long shadows.
Color: dominant icy blue #5B8DEF and #8FB4FF, desaturated, frost-white edges.
Mood: loss, memory freezing over, quiet dread.
Audio: a soft icy shimmer, low sub-bass, room tone thinning out. No music.
Duration: 8 seconds.

Negative prompt: no readable text, no code, no user interface, no legible screen
content, no snow storm, no cartoon ice, no captions, no on-screen writing.
```

---

## 🎬 AI CLIP 3 — The warm-up: orange bloom fills the room (THE money shot)

```
Warm orange light blooms outward from the center of the frame and spreads across
the cold blue room. As the warmth travels, the frost melts and retreats from the
edges, ice crystals dissolving into tiny glowing embers. The color temperature of
the whole scene swings from icy blue to warm fire-orange over about one second. The
developer, seen from behind, relaxes their shoulders as warmth returns. Cinematic,
photoreal, emotional, hopeful.

Camera: slow, smooth push-in following the warm light as it spreads.
Lighting: an orange glow source growing from screen level, warm key overtaking the
cold blue, soft ember highlights.
Color: transition from cold #5B8DEF to warm #FF6B35 and #F7931E, gold #FFAB00 embers.
Mood: relief, coming home, warmth returning, being remembered.
Audio: a rising warm swell, low hum resolving to a soft glow, gentle ember crackle.
Duration: 8 seconds.

Negative prompt: no readable text, no code, no user interface, no fire hazard, no
big flames, no explosion, no captions, no on-screen writing.
```

---

## 🎬 AI CLIP 4 — Logo backdrop: embers on black (for the end card)

```
Slow-drifting glowing embers and soft flame particles rising through pure darkness,
like the last warm sparks of a fire. Gentle bokeh, deep black background, cinematic,
elegant, minimal. Leaves a calm empty center of frame for a logo to be placed later.

Camera: static, subtle slow drift upward of the particles.
Lighting: self-lit embers only, everything else black.
Color: near-black #0d0f16 with warm #FF6B35 and gold #FFAB00 embers.
Mood: calm, premium, warm afterglow.
Audio: soft low warm drone, faint ember crackle. No music.
Duration: 8 seconds.

Negative prompt: no readable text, no logos, no user interface, no big flames, no
explosion, no captions, no on-screen writing.
```

*(Optional 5th clip if budget allows — a close-up of the developer's tired face
lifting into a small relieved half-smile as cold blue light turns warm orange on
their skin. Nice humanity beat, but skippable to save one generation.)*

---

## 🖥️ REAL SCREEN RECORDING — do NOT generate these with AI

These carry the product's credibility and your honesty rule. Record them free with OBS/asciinema:

- **R1 — Cold session:** a fresh chat that knows nothing. AI says *"Hi! How can I help you today?"* You start re-typing yesterday's explanation. (Overlay the cold blue grade in the editor.)
- **R2 — The recall (the payoff):** a new session opens and the AI leads with the **real** Prisma gotcha:
  > 🔥 *"Welcome back — last session you were mid auth-rewrite. Heads up: Prisma 6 holds a DLL lock on `query_engine.dll` while `tsx watch` runs — stop the watcher before you migrate. Want me to do that first?"*
- **R3 — The how:** `amp_write` firing mid-work; the `.ai-memory/…jsonl` file on disk; the same memory showing in Cursor / Claude Code / Copilot.

Composite: AI clips = the emotional wrapper; real recordings = the proof, dropped into the warm section. The temperature grade (cold blue → warm orange) is applied in the editor to tie AI and real footage into one look.

---

## 🎙️ Voice-over (cheap, no mic needed)
Feed the VO scripts from `SHOT_LIST_screencast_2_cold_to_warm.md` into **ElevenLabs** (free tier covers a 60s clip) for natural Hebrew and English reads. One calm male/neutral voice, slow pace. Put VO on Cut B only; keep the social loop (Cut A) silent + captioned.

## Assembly order (free tools)
1. Veo clips 1→2 = the cold half. Drop R1 in, graded cold.
2. Veo clip 3 = the warm swing. Drop R2 (the recall) right on the color flip — that's the emotional peak.
3. R3 quick how-it-works beats, warm.
4. Veo clip 4 + logo card + install line.
5. Music: one "cold-sparse-to-warm-bloom" track from YouTube Audio Library (free). Add VO for Cut B. Export Cut A as the silent 12s loop.

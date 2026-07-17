# Veo 3.1 — Pack v2: "Ron's Story" (the thought-bubble snow / fireplace film)

**The story (Ron's concept):**
1. Camera pushes in from behind the developer toward the screen — he realizes he has to open a new session.
2. A **thought bubble** appears above him: inside it he sees himself **freezing** — white wool coat, snow all around, alone in the cold. (New session = getting lost in the cold.)
3. Caption: **"זה לא חייב להיות ככה קר — אם יש לך infernoflow"** / EN: *"It doesn't have to be this cold — not if you have infernoflow."*
4. He enters a warm room: a **wise old man warming his hands over a burning fireplace** says: **"אבל לך יש את inferno."** / EN: *"But you — you have inferno."*
5. Warm ending + logo + install line.

**Division of labor (this is what keeps it cheap and good):**
- **Veo generates 3 clips** — pure cinematography, no text, no bubbles, no talking.
- **The editor (CapCut/DaVinci, free) adds** — the thought-bubble mask, the captions, the old man's line as voice-over (ElevenLabs). Veo cannot do legible text, clean bubbles, or Hebrew lip-sync — so we don't ask it to.
- **Old man choice (default):** he is framed so his mouth is NOT clearly visible (side/behind angle, low light) → his line plays as VO. If you'd rather see him face-on, we still don't lip-sync — keep the line as VO/caption.

**Veo UI settings (do these in the interface, not the prompt):**
- Aspect ratio dropdown: **9:16** (the square 1:1 you got happened because this wasn't set — the UI setting overrides the prompt).
- Draft/fast mode for tries; final-render only the keeper.
- Budget: 3 new clips × 8s (+ reuse the embers clip from pack v1 for the logo card — no new generation).

---

## 🎬 CLIP A — Push-in on the developer (the setup)

```
Vertical 9:16 composition. Slow steady camera push-in from behind a lone software
developer at a dark desk at night, moving over his shoulder toward the bright glowing
monitor. His posture tightens slightly — a small pause, hands lifting off the keyboard,
a beat of hesitation, as if realizing something inconvenient. The screen glow is the
only light. Quiet, intimate, contemplative. Cinematic, photoreal, shallow depth of field.

Camera: one continuous slow dolly push-in from behind the shoulder toward the screen.
Lighting: low-key, cool-neutral monitor glow, deep shadows, near-black room #0d0f16.
Color: neutral leaning slightly cold, muted.
Mood: hesitation, "here we go again," the moment before starting over.
Audio: soft room tone, one last keyboard click, low hum. No music.
Duration: 8 seconds. Aspect ratio: 9:16 vertical.

Negative prompt: no readable text, no code, no user interface, no legible screen
content, no captions, no thought bubbles, no frost, no fire, no black bars.
```
*(In the edit, the push-in slows and the thought bubble is composited above his head
at ~second 5.)*

---

## 🎬 CLIP B — Inside the thought bubble: lost in the snow

```
Vertical 9:16 composition. A person wrapped in a thick white wool coat with the hood
up stands alone in a vast snowy landscape at dusk, hugging themselves against the
cold, breath fogging, snowflakes drifting down. They look small in the frame,
surrounded by white emptiness. Slight shiver. Melancholic, isolated, freezing.
Cinematic, photoreal, soft focus edges.

Camera: slow gentle zoom-out, making the figure feel smaller and more alone.
Lighting: flat overcast winter light, blue-grey dusk.
Color: icy blue #5B8DEF and white, fully desaturated warm tones.
Mood: cold, lost, starting from nothing.
Audio: thin winter wind. No music.
Duration: 8 seconds. Aspect ratio: 9:16 vertical.

Negative prompt: no readable text, no captions, no buildings, no other people, no
blizzard whiteout, no cartoon style, no black bars.
```
*(This clip is masked INTO the thought bubble in the editor — soft-edged ellipse +
two small trailing circles down to his head. Keep the figure centered so the crop
survives the mask.)*

---

## 🎬 CLIP C — The old man at the fireplace (the warm answer)

```
Vertical 9:16 composition. A warm rustic room at night lit by a burning fireplace.
An old man with white hair and a kind, weathered presence stands at the hearth,
seen from the side and slightly behind, his face mostly in warm shadow, stretching
his open hands toward the fire to warm them. Firelight flickers gently on the walls.
The flames stay small and contained inside the fireplace. Calm, wise, welcoming.
Cinematic, photoreal.

Camera: slow drift-in from the side, settling on his hands over the fire.
Lighting: firelight as the only source — warm orange #FF6B35 and amber #F7931E,
soft flicker, deep cozy shadows.
Color: fully warm palette, golds #FFAB00 and ambers, near-black edges #0d0f16.
Mood: warmth, wisdom, safety, "come sit by the fire."
Audio: gentle fire crackle, quiet room. No speech. No music.
Duration: 8 seconds. Aspect ratio: 9:16 vertical.

Negative prompt: no speech, no moving lips, no readable text, no captions, no house
fire, no spreading flames, no smoke filling the room, no black bars.
```
*(His line is added as VO in the edit — never generated as lip-sync.)*

---

## 🎬 CLIP D — Logo backdrop
**Reuse** `embers on black` from pack v1 (already generated/prompted). No new spend.

---

## ✂️ Edit assembly (CapCut or DaVinci Resolve — free)

Timeline for the ~30s story cut:

| Time | Video | Overlay / text | Audio |
|---|---|---|---|
| 0–6s | CLIP A push-in | — | room tone |
| 5–13s | CLIP A freeze-frame (or slowed tail) | **Thought bubble** appears above his head, CLIP B masked inside (soft ellipse + 2 small circles) | thin wind bleeds in |
| 13–17s | hold on bubble | Caption fades in: **"זה לא חייב להיות ככה קר — אם יש לך infernoflow"** (EN cut: *"It doesn't have to be this cold — not if you have infernoflow."*) | wind fades |
| 17–25s | CLIP C old man / fireplace | — | fire crackle + VO: **"אבל לך יש את inferno."** (EN: *"But you — you have inferno."*) |
| 25–30s | CLIP D embers | Logo 🔥 infernoflow + `npm i -g infernoflow` + `infernoflow.dev` | warm swell out |

**Thought-bubble how-to (2 minutes in CapCut):** duplicate track → place CLIP B above CLIP A → Mask: ellipse, feather ~15% → resize to upper third of frame → add a white 3–4px stroke (or a PNG bubble outline) → two small white circles stepping down toward his head → subtle float animation (scale 100→103% loop).

**VO (ElevenLabs, free tier):** pick an aged, warm male voice. Two renders: Hebrew line + English line. Slow delivery, almost a whisper by the fire.

**Caption font:** bold sans (Heebo/Rubik for Hebrew — free on Google Fonts), white with soft shadow; keep inside the vertical safe zone (bottom 15% clear).

**Short loop cut (8–12s) for socials:** bubble-with-snow beat → caption → 1s of fireplace → logo. Silent + captions.

---

## Honesty check (Ron's rule)
This film is pure metaphor — cold session vs. warm — and claims nothing technical, so nothing to fact-check. Keep any *product* moments (if you later splice in a recall demo) as REAL screen recordings, per `SHOT_LIST_screencast_2_cold_to_warm.md`.

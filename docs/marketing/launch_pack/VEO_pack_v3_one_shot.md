# Veo 3.1 — Pack v3: ONE environment, one continuous shot (Ron's final vision)

**The vision:** the whole story in a single room, minimal cuts — ideally one continuous
camera move: wide room → push in behind the developer → (thought bubble: him walking in
snow, seen from the side) → pull back to reveal the fireplace in the SAME room, an old
man warming his hands — **palms open TOWARD the fire** — saying "אל תדאג, יש לך inferno" →
the developer turns his head and smiles → zoom down to the keyboard → he presses Enter.

**Reality of the tool:** Veo generates max ~8s per clip — a true 25s one-shot isn't
possible in one generation. The closest thing: **Flow's "Extend" feature** — each segment
continues from the LAST FRAME of the previous one, keeping the same environment and
camera flow. Chain 3 segments = one seamless continuous shot. That's what this pack does.

**The thought bubble** still gets composited in the edit (Veo can't draw a clean bubble),
but it's overlaid on the SAME continuous footage — so the one-shot feel is preserved.
The snow scene is one extra small clip, masked into the bubble.

---

## 🏠 MASTER ENVIRONMENT (paste this block at the top of EVERY segment prompt — it keeps the room consistent)

```
Environment: one warm rustic home office at night. On the left, a wooden desk with a
glowing computer monitor where a young developer sits with his back to camera. On the
right side of the same room, a stone fireplace with a small contained fire burning.
Warm amber firelight #F7931E mixes with cool monitor glow. Wooden beams, deep cozy
shadows, near-black corners #0d0f16. Cinematic, photoreal, shallow depth of field,
vertical 9:16 composition.
```

---

## 🎬 SEGMENT 1 (0–8s) — Wide → push-in behind the developer

```
[MASTER ENVIRONMENT block]

Action: the shot opens WIDE showing the whole room — desk and glowing monitor on the
left, the stone fireplace burning softly on the right. The camera slowly and smoothly
pushes in toward the developer from behind, settling just over his shoulder facing the
monitor glow. He pauses, hands lifting slightly off the keyboard — a small beat of
hesitation, thinking.

Camera: one continuous slow dolly push-in, wide room → over-the-shoulder. No cuts.
Audio: quiet room tone, soft fire crackle from the right, one keyboard click. No music,
no speech.
Duration: 8 seconds. Aspect ratio: 9:16 vertical.

Negative prompt: no readable text, no code, no user interface, no captions, no thought
bubbles, no camera cuts, no scene change, no black bars.
```
*(Edit note: the thought bubble + snow clip are composited over the tail of this
segment, while the camera holds on his shoulders.)*

## 🎬 SEGMENT 2 (8–16s) — Pull back and reveal the old man at the fireplace
**Generate with Flow → Extend from Segment 1's last frame.**

```
[MASTER ENVIRONMENT block]

Action: continuing the same shot with no cut — the camera gently pulls back from the
developer's shoulder and arcs right, revealing the stone fireplace in the same room.
An old man with white hair and a kind weathered face stands at the hearth, holding his
open hands toward the flames, PALMS FACING THE FIRE, warming them. He glances toward
the developer and speaks calmly, saying: "Don't worry — you've got inferno." The
firelight flickers warmly on his face and hands.

Camera: one continuous move — slow pull-back and arc from the desk to the fireplace,
ending framed on the old man with the developer's silhouette at frame edge. No cuts.
Audio: fire crackle; the old man's calm warm voice speaking the line. No music.
Duration: 8 seconds. Aspect ratio: 9:16 vertical.

Negative prompt: no readable text, no captions, no house fire, no spreading flames,
no smoke filling the room, no camera cuts, no scene change, no black bars.
```
*(Dialogue: Veo 3.1 generates native audio — try the English line in-prompt first.
For the Hebrew version "אל תדאג, יש לך inferno" — replace the spoken line with VO from
ElevenLabs in the edit; don't ask Veo to speak Hebrew, and mute its generated line.)*

## 🎬 SEGMENT 3 (16–24s) — The smile → zoom to the keyboard → Enter
**Generate with Flow → Extend from Segment 2's last frame.**

```
[MASTER ENVIRONMENT block]

Action: continuing the same shot with no cut — the developer turns his head toward the
old man and gives a small relieved smile, warm firelight catching the side of his face.
The camera then glides smoothly from his face down and forward to a close-up of the
keyboard. His finger presses the Enter key — one decisive, satisfying keystroke. The
monitor glow warms slightly as the key lands.

Camera: one continuous move — from his turning head, diving down to a keyboard
close-up, ending tight on the Enter key press. No cuts.
Audio: soft fire crackle, one clean satisfying key press. No speech. No music.
Duration: 8 seconds. Aspect ratio: 9:16 vertical.

Negative prompt: no readable text on screen, no code, no user interface, no captions,
no camera cuts, no scene change, no black bars.
```

## 🎬 EXTRA CLIP — Snow walk (for inside the thought bubble)

```
Vertical 9:16. A person wrapped in a thick white wool coat with the hood up walks
slowly through deep snow, seen from the SIDE in profile, trudging left to right
against a vast empty winter landscape at dusk. Breath fogging, snowflakes drifting,
arms hugged tight against the cold. Small in the frame, alone. Cinematic, photoreal.

Camera: static side view, the figure walking through the frame.
Color: icy blue #5B8DEF and white, no warm tones.
Audio: thin winter wind. Duration: 8 seconds. Aspect ratio: 9:16 vertical.

Negative prompt: no readable text, no captions, no buildings, no other people, no
blizzard whiteout, no black bars.
```

---

## ✂️ Edit assembly (the one-shot cut, ~24–28s)

| Time | Footage | Overlay |
|---|---|---|
| 0–8s | Segment 1 | at ~5s: thought bubble fades in above his head, snow-walk clip masked inside (soft ellipse + 2 small circles) |
| ~7s | — | caption: **"זה לא חייב להיות ככה קר — אם יש לך infernoflow"** |
| 8–16s | Segment 2 (bubble pops/fades as camera moves) | HE cut: mute Veo's line, lay ElevenLabs VO **"אל תדאג — יש לך inferno."** / EN cut: keep native line if it came out clean |
| 16–24s | Segment 3 | — |
| 24–28s | embers clip (pack v1) | logo 🔥 + `npm i -g infernoflow` + infernoflow.dev |

**Continuity tips for Extend:** always extend from the final frame, keep the MASTER
ENVIRONMENT block identical in all three prompts, and don't change lighting words
between segments. If a seam is visible, hide it exactly on the bubble pop (8s) — the
viewer's eye is on the bubble, not the background.

**Veo UI:** aspect 9:16 in the dropdown (not just the prompt) · draft mode for tries ·
final-render keepers only. Budget: 4 generations total (3 segments + snow).

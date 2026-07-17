# Veo pack v3.1 — SEGMENT 2+3 FIX (Ron's corrected choreography)

**What changed from v3:** the old man doesn't "already stand" at the fireplace — he
**ENTERS the room**, walks to the hearth, warms his palms toward the fire, and only
then turns his head to the developer and speaks. The final beat shows the developer
smile and press Enter. Segments are 8s each. Segment 1 (push-in on the developer) is
already generated and approved — keep it.

Chain: Segment 1 (done ✓) → Extend → Segment 2 → Extend → Segment 3.
Paste the MASTER ENVIRONMENT block at the top of every prompt, unchanged:

```
Environment: one warm rustic home office at night. On the left, a wooden desk with a
glowing computer monitor where a young developer sits with his back to camera. On the
right side of the same room, a stone fireplace with a small contained fire burning.
Warm amber firelight #F7931E mixes with cool monitor glow. Wooden beams, deep cozy
shadows, near-black corners #0d0f16. Cinematic, photoreal, shallow depth of field,
vertical 9:16 composition.
```

---

## 🎬 SEGMENT 2 (8–16s) — The old man ENTERS → walks to the fireplace → warms his palms → turns his head and speaks
**Flow → Extend from Segment 1's last frame.**

```
[MASTER ENVIRONMENT block]

Action: continuing the same shot with no cut — an old man with white hair and a kind,
weathered face ENTERS the room from a doorway on the right and walks slowly and calmly
toward the burning fireplace. He stops at the hearth and stretches both open hands
toward the flames, PALMS FACING THE FIRE, warming them. After a moment he turns his
head toward the developer at the desk and speaks gently and warmly, saying:
"Don't worry — you've got inferno." The firelight flickers on his face and open palms.
The developer's silhouette stays visible at the left edge of the frame.

Camera: one continuous gentle move — drifting right from behind the developer to frame
the doorway and the fireplace, following the old man's walk, settling on him at the
hearth as he turns his head. No cuts.
Audio: soft footsteps on wood, fire crackle, then the old man's calm warm voice
speaking the line. No music.
Duration: 8 seconds. Aspect ratio: 9:16 vertical.

Negative prompt: no readable text, no captions, no house fire, no spreading flames,
no smoke filling the room, no camera cuts, no scene change, no teleporting, no
black bars.
```

*Hebrew cut: mute Veo's spoken line and lay ElevenLabs VO — "אל תדאג — יש לך inferno."*

---

## 🎬 SEGMENT 3 (16–24s) — The developer smiles → presses Enter (we SEE the developer)
**Flow → Extend from Segment 2's last frame.**

```
[MASTER ENVIRONMENT block]

Action: continuing the same shot with no cut — the camera glides left back to the
developer at the desk. He turns his head toward the old man at the fireplace and gives
a small, relieved smile, warm firelight catching the side of his face. He turns back
to the monitor, and the camera moves down and forward to a close-up of the keyboard as
his finger presses the Enter key — one decisive, satisfying keystroke. The monitor
glow warms slightly as the key lands.

Camera: one continuous move — glide left from the fireplace to the developer's face,
hold on the smile, then dive down to a keyboard close-up ending tight on the Enter
key press. No cuts.
Audio: soft fire crackle, one clean satisfying key press. No speech. No music.
Duration: 8 seconds. Aspect ratio: 9:16 vertical.

Negative prompt: no readable text on screen, no code, no user interface, no captions,
no camera cuts, no scene change, no black bars.
```

---

## ✂️ Updated timeline (~28–32s story cut)

| Time | Footage | Overlay / audio |
|---|---|---|
| 0–8s | Seg 1 (done ✓) | at ~5s: thought bubble + snow-walk clip masked in; caption "זה לא חייב להיות ככה קר — אם יש לך infernoflow" |
| 8–16s | Seg 2 | bubble pops as the door opens (hides any Extend seam); old man's line (EN native / HE VO) |
| 16–24s | Seg 3 | the smile → Enter |
| 24–28s | embers clip (v1) | logo 🔥 + `npm i -g infernoflow` + infernoflow.dev |

**Seam-hiding trick:** time the thought-bubble pop to the exact frame the old man's
door movement starts — the eye follows the new motion and misses the transition.

**Still needed:** the snow-walk clip (prompt in pack v3) if not generated yet.

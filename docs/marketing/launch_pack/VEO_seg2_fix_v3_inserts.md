# Veo — Segment 2 FIX v3: film grammar instead of fighting the model

**The two stubborn problems** — palms not facing the fire, whole body turning instead
of just the head — are fine-motor control, which is text-to-video's weakest skill.
Re-prompting the same single shot will keep failing. The fix is how real films do it:
**split the moment into 3 tiny shots, each one something Veo is reliably good at.**
Cutting between them looks MORE cinematic, not less (it's called an insert shot).

Also: your PREVIOUS take of the old man SPEAKING (the close warm shot) was good —
keep that footage. We may only need to generate 2 new short pieces.

---

## 🎬 Shot 2a — The walk (wide, no hand details asked for)

```
Vertical 9:16 composition. A warm rustic home office corner at night: a stone
fireplace with a small contained fire burning, wooden beams, deep cozy shadows,
near-black corners #0d0f16, warm amber firelight. The frame shows ONLY the fireplace
corner — no desk, no computer, nobody else.

Action: an old man with white hair and a warm beige knit cardigan enters the frame
from the left and walks slowly and calmly toward the fireplace. He stops in front of
the hearth, facing the fire, and begins reaching his hands toward its warmth.

Camera: static medium-wide shot, letting him walk through the frame. No cuts.
Audio: slow footsteps on wood, gentle fire crackle. No speech. No music.
Duration: 8 seconds.

Negative prompt: no other people, no woman, no desk, no computer, no readable text,
no captions, no house fire, no spreading flames, no camera cuts, no black bars.
```
*(We don't ask for palm orientation here at all — the wide shot hides it.)*

---

## 🎬 Shot 2b — INSERT: the hands toward the fire (the shot that fixes the palms)

The trick: put the camera BEHIND the hands. When the camera is behind him and the
fire is in front, the palms face the fire automatically — the model can't get it wrong.

```
Vertical 9:16 composition. Close-up insert shot from BEHIND an old man's shoulders:
his two weathered hands, in beige knit cardigan sleeves, reach out AWAY from the
camera toward a burning fireplace in front of him. The backs of his hands are toward
the camera; his open palms face the flames. Fingers spread, hands hovering and slowly
warming, gentle small movements. The fire glows softly, slightly out of focus, warm
amber light wrapping the fingers. Cinematic, photoreal, shallow depth of field.

Camera: static close-up over his shoulder, focused on the hands against the fire glow.
Audio: gentle fire crackle only. No speech. No music.
Duration: 8 seconds (only ~2-3 seconds are used in the edit).

Negative prompt: no face, no full body, no palms toward the camera, no readable text,
no captions, no house fire, no spreading flames, no camera cuts, no black bars.
```

**Zero-cost alternative for this shot:** free stock sites (Pexels / Pixabay) have real
clips of "hands warming by fireplace" — search exactly that. A real filmed insert here
is indistinguishable and costs nothing. Totally legitimate.

---

## 🎬 Shot 2c — The head turn + the line (over-the-shoulder glance — the motion models DO know)

The trick: "turn only your head" fails, but "glance back over your shoulder toward the
camera" is a motion Veo has seen a million times and does correctly — and we shoot it
from three-quarter BEHIND him so his body staying put is built into the framing.

```
Vertical 9:16 composition. Medium shot from behind and slightly to the side of an old
man with white hair and a warm beige knit cardigan (three-quarter back angle). He
stands facing a burning stone fireplace, his hands extended toward the flames, warm
firelight around his silhouette. Keeping his body and hands toward the fire, he
GLANCES BACK OVER HIS SHOULDER toward the camera with a kind, warm smile and speaks
gently: "Don't worry — you've got inferno." Then he turns his gaze back to the fire.

Camera: static, framed over his back shoulder; his face becomes visible in profile as
he glances back. No cuts.
Audio: fire crackle, his calm warm voice speaking the line. No music.
Duration: 8 seconds.

Negative prompt: no full body turning around, torso stays facing the fireplace, no
walking, no other people, no readable text, no captions, no house fire, no camera
cuts, no black bars.
```
*Hebrew cut: mute the generated line, lay ElevenLabs VO "אל תדאג — יש לך inferno."
timed to the glance.*

---

## ✂️ The edit (why this looks BETTER than one take)

| Order | Shot | Used length |
|---|---|---|
| 1 | 2a — walk to the hearth | ~4s |
| 2 | 2b — hands insert (palms to fire) | ~2s |
| 3 | 2c — over-shoulder glance + line (or your GOOD previous speaking take) | ~4s |

Walk → cut to hands → cut to glance-and-line is textbook film grammar. Each cut lands
on an action start, so it feels intentional. And if any one generation misbehaves,
you only regenerate that 8s piece — never the whole scene.

**Cost note:** 2a and 2c are the only must-generates (2b can be free stock). If your
earlier "speaking" take is good enough, you may only need 2a + stock hands = one new
generation.

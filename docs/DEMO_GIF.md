# Demo GIF — recording shot list

Goal: a ~30-second GIF for the README that shows the magic moment — install,
log a gotcha, generate a handoff, paste into an AI session.

## Tools

- **Windows:** [ScreenToGif](https://www.screentogif.com/) (free, MIT)
- **macOS:** [Kap](https://getkap.co/) (free, MIT)
- **Linux:** [Peek](https://github.com/phw/peek) (free, GPL)

Set window size to about **800 × 500** for a sharp embed in GitHub.

## Recording prep (do once before recording)

1. Open Windows Terminal (NOT cmd — it renders unicode cleanly)
2. Set font to 14pt, dark theme. White-on-dark looks best in GIFs.
3. `cd %USERPROFILE%\Desktop`
4. `mkdir demo-app`
5. `cd demo-app`
6. `echo {"name":"demo-app","version":"1.0.0"} > package.json`
7. `cls` (clear)

## Shot list (30 seconds)

Hit record, then run these commands. Pause briefly between each so the GIF
captures distinct frames:

| t   | Command | What appears |
|-----|---------|--------------|
| 0s  | `npm install -g infernoflow` | npm install output flashes by, then "+ infernoflow@…" |
| 5s  | `infernoflow init` *(press Enter at the gotcha prompt to skip — or type a real one)* | "🔥 infernoflow — let's get you set up" + green check |
| 10s | `infernoflow log "API returns 202 not 200" --type gotcha` | "✔ Logged [gotcha]: API returns 202 not 200" |
| 14s | `infernoflow log "use polling not websocket" --type decision` | "✔ Logged [decision]:…" |
| 18s | `infernoflow switch` | The new STOP-banner handoff scrolls past, "✔ Written → .ai-memory/handoff.md", health grade A |
| 25s | `infernoflow switch --copy` | "✔ Copied to clipboard — paste at the start of your next AI session" |
| 28s | (optional) Switch to Claude / Cursor and Ctrl+V into a fresh chat | The handoff appears inline, AI immediately knows the gotchas |

Stop recording at ~30 seconds.

## Post-processing

- Trim dead frames at the start/end.
- Export at **15 fps**, **infinite loop**.
- Target file size: **under 5 MB** so GitHub renders it inline (anything over
  10 MB gets a "click to view" intercept). If it's too big, drop the framerate
  to 10 fps or chop the install step.

## Where it goes

1. Save the file as `docs/demo.gif` in the repo.
2. Add to README, just above the existing "## The 60-second pitch" section:

   ```markdown
   ![infernoflow demo](docs/demo.gif)
   ```

That single line makes the GIF the first thing every visitor sees on
github.com/ronmiz/infernoflow and on the npm package page.

## Quality bar (rough)

It's good enough when:
- The whole thing fits in one continuous shot, no cuts.
- The handoff is **legible at native size** — viewers can read the gotcha and
  the file path without zooming.
- Total duration ≤ 35 seconds (fewer is better).
- File size ≤ 5 MB.

It's NOT good enough if:
- Text is fuzzy (lower DPI than the recorder is running at — fix by setting
  ScreenToGif's "Use desktop scaling" off and recording at native resolution).
- The terminal background is very different from the README's GitHub theme
  (white-on-dark is the safest bet).
- The cursor is a giant block obscuring text — disable cursor-highlight in
  the recorder if it's on.

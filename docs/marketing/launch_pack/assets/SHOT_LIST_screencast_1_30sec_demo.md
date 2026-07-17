# Shot List — Screencast #1: "30-Second Demo"

**Goal:** Show a new user going from `npm install` to Claude reading a logged gotcha, in under 30 seconds. This is the video that runs at the top of every launch post.

**Duration:** 25-35 seconds
**Format:** MP4, 1920×1080 (or 1440×900 for retina Mac look), 30-60 fps
**Audio:** Voice-over OR silent with on-screen captions. Recommend silent + captions — plays without sound on autoplay feeds (Twitter, LinkedIn).
**Delivery formats to export:** MP4 (embed) + WebM (web-optimized) + GIF 5-8 sec loop (highlight of AI reading memory)

---

## Setup — before you hit record

1. **Empty demo directory** — `mkdir C:\demo && cd C:\demo`
2. **VS Code window sized to 1920×1080** (or your recording resolution). Use one instance, clean state.
3. **Fresh terminal** in VS Code — clear it with `cls`. Set font to Consolas 16pt.
4. **Uninstall infernoflow globally first** — so the `npm install -g` step is real, not cached
   ```powershell
   npm uninstall -g infernoflow
   ```
5. **Copilot Chat panel** open on the right side of VS Code, ready to accept a prompt.
6. **Recorder:** OBS Studio, region set to the VS Code window. Or ScreenToGif for GIF-only version.
7. **Clean desktop** — hide the taskbar, close all other windows.
8. **Zoom to 130%** in VS Code (Ctrl + `=`) so text reads clearly at 720p downsample.

---

## Shot-by-shot (voice-over script + on-screen action)

### 00:00-00:03 — HOOK
- **On-screen:** Static VS Code window, black terminal at bottom, blank editor.
- **Overlay text (large, top of screen):**
  > "Your AI forgets everything between sessions."
- **VO (optional):** *"Every new AI session starts cold."*
- **Editing note:** Hold this frame 3 seconds. Fade the overlay out around 00:02.5.

### 00:03-00:07 — INSTALL
- **Action:** In the terminal, type:
  ```
  npm install -g infernoflow
  ```
  Hit Enter. Let npm actually run — it should complete in ~2 seconds.
- **Overlay text (small, top-right):** `Step 1 / 3 · install`
- **VO:** *"One command."*

### 00:07-00:12 — INIT
- **Action:** Type:
  ```
  infernoflow init --yes
  ```
  Hit Enter. Init completes with the ~8-line green output showing MCP registrations.
- **Overlay text:** `Step 2 / 3 · wire up`
- **Editing note:** Zoom in on the terminal (~15% zoom-in over the 5 seconds) so viewer can read the green checkmarks.
- **VO:** *"That wires MCP into Cursor, Claude Code, and Copilot Chat."*

### 00:12-00:18 — LOG A GOTCHA
- **Action:** In Copilot Chat (right panel), type:
  > `@workspace we just found: Prisma 6 locks query_engine.dll while tsx watch is running — kill the watcher before migrate. Log this.`
  Hit Enter. Copilot responds:
  > *"I've logged that gotcha via amp_write..."* (or similar)
- **On-screen highlight:** Draw a subtle glow around the `amp_write` mention in Copilot's response.
- **VO:** *"Copilot logs the gotcha itself."*

### 00:18-00:26 — THE PAYOFF
- **Action:** Close the Copilot Chat window. Open a NEW chat (Ctrl+Shift+I → New Chat). Type:
  > `@workspace I want to run prisma migrate dev — anything I should know?`
  Hit Enter. Copilot responds with:
  > *"I noticed a logged gotcha about Prisma 6 DLL locking during tsx watch. Do you want me to stop the watcher first?"*
- **Overlay text (bottom-third):** `New session · new prompt · still remembers`
- **Editing note:** Slow-mo (0.7×) the Copilot response as it types. This is the punchline — let it land.
- **VO:** *"Next session — still there."*

### 00:26-00:30 — CLOSE
- **On-screen:** Fade to the infernoflow logo mark on black. Small URL at the bottom.
- **Text:**
  ```
  🔥 infernoflow
  Persistent memory for AI coding sessions
  infernoflow.dev · npm i -g infernoflow
  ```
- **VO (optional):** *"infernoflow. Local, git-tracked, MIT."*

---

## Editing checklist

- [ ] Keyboard sound effects on typing (subtle — mechanical, not clacky). Free source: mixkit.co
- [ ] Terminal output punctuated with soft "click" on each new line appearing
- [ ] Zooms use eased curves (not linear) — feels premium
- [ ] Captions burned in AND provided as .srt sidecar file
- [ ] Frame the final logo shot for at least 2 full seconds
- [ ] Export at 4-8 Mbps for MP4, quality preset "High" or CRF 20 in ffmpeg
- [ ] GIF export: seconds 12-25 only (the "log + retrieve" moment), max 8MB for Twitter

---

## Where this video will run

- **infernoflow.dev homepage** — embedded above the fold, autoplay muted, loop
- **HN comment #1 by author** — link to hosted MP4 with the timestamp of the payoff moment
- **Twitter thread tweet 2** — embedded MP4 (Twitter accepts up to 2:20 native video)
- **dev.to post** — embedded as YouTube (unlisted)
- **Reddit r/GithubCopilot post** — v.redd.it upload (native Reddit player)
- **Marketplace listing** — link in the "Overview" section
- **YouTube channel** — public, title "infernoflow — 30 seconds to persistent AI memory"

---

## Tools you already have or should install (Windows)

- **OBS Studio** — free screencasting. Download: obsproject.com
- **ScreenToGif** — free, tiny, made-for-Windows GIF recorder. github.com/NickeManarin/ScreenToGif
- **DaVinci Resolve (free tier)** — professional editor. Overkill for 30-sec but great to learn once. Alternative: **Clipchamp** (built into Windows 11).
- **ffmpeg** — for GIF optimization + MP4 re-encoding. Install via `winget install ffmpeg`.

---

## Time budget

- Setup + rehearsal: 30 min
- Recording: 15 min (expect 3-5 takes)
- Editing: 60-90 min
- Export + upload: 15 min

**Total: ~2-2.5 hours** for a professional-looking 30-second video.

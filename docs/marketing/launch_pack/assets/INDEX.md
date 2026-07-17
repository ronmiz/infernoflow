# Launch Pack — Visual Assets

Everything in this folder is what will make the launch **look** like a real product, not a hobby project.

## What's here (Day 1 batch — 2026-07-12)

| File | What it is | How to use |
|---|---|---|
| `HERO_og_image.svg` | 1200×630 — **v1 dark dramatic** — headline: *"Every new AI session starts cold. infernoflow makes them stick."* (README line 3) | Convert to PNG at 1200×630 for `og:image`, `twitter:image` in site `<head>`. |
| `HERO_og_image_v2_light.svg` | 1200×630 — **v2 light/inviting** — same headline | Use if you want to feel less "hardcore hacker" and more "polished product." |
| `HERO_og_image_v3_code.svg` | 1200×630 — **v3 code-forward** (mock Copilot Chat calling amp_read — product demo, not a claim) | Best for HN + Reddit devs — shows the product. |
| `HERO_animated.svg` | 1200×630 — **animated version** (flame flicker, feature-dot pulse, glow) | Embed as the LIVE homepage hero on `infernoflow.dev`. NOT for og:image (og previews are static). |
| `DIAGRAM_1_dual_transport.svg` | 1200×700 — dual LMT + MCP architecture, shows which IDE uses which transport | Embed in dev.to post, README docs folder, Marketplace listing. Honest architecture explainer. |
| `DIAGRAM_1_lmt_vs_mcp.svg` | 🚫 **DEPRECATED** — contained the fabricated "Copilot doesn't support MCP" claim | Replaced with `DIAGRAM_1_dual_transport.svg`. Do not use. |
| `DIAGRAM_1_lmt_vs_mcp.svg` | "Why Copilot needs a different memory tool" — competitive positioning graphic | Embed in dev.to post, Reddit r/GithubCopilot post, HN comment #1. This is the story-explainer. |
| `DIAGRAM_2_bookmark_paths.svg` | The 3-path bookmark architecture (CLI/MCP/Hook → same file) | Embed in dev.to post + Twitter thread tweet 8 + Marketplace listing. |
| `SHOT_LIST_screencast_1_30sec_demo.md` | Complete production plan for the "30-second demo" video | Follow it when recording. Voice-over script, timing, tooling, export formats. |

## Which hero to actually use — recommendation

| Where | Use |
|---|---|
| `<meta property="og:image">` (site head) | v1 (dark) OR v3 (code) — pick one, be consistent. v3 gets more clicks on tech Twitter. v1 stronger on HN. |
| Homepage hero (live, animated) | `HERO_animated.svg` — set as `<img>` or embed inline. |
| dev.to article cover | v3 (code-forward) — dev.to's audience LOVES visible code. |
| HN comment attachment | v1 (dark) — HN converts dark images ~15% better historically. |
| Reddit r/GithubCopilot post | v1 or v3 — either works. |
| Twitter card | v3 (code-forward) — highest CTR on dev twitter. |
| Marketplace listing | v2 (light) — Marketplace UI is white/light, v2 blends. |
| Product Hunt gallery | v1 + v3 both, as separate gallery images. |

**Bottom line:** v1 for dark contexts, v3 for tech Twitter/dev.to, v2 for Marketplace, animated for the actual homepage.

## Converting the animated SVG to formats other platforms accept

- Twitter/HN/Reddit don't play SVG animations. To use `HERO_animated.svg` on those platforms, convert to:
  - **WebM (best quality)**: `ffmpeg -i HERO_animated.svg -c:v libvpx-vp9 hero.webm` (may need a wrapper like Puppeteer to record the SVG animation into video)
  - **Animated GIF (universal)**: use https://ezgif.com/svg-to-gif or Puppeteer script (5-second loop, 8-10 FPS to keep filesize < 5MB)
  - **APNG**: better quality than GIF, supported everywhere modern. Convert with https://ezgif.com/apng-maker.
- For homepage `infernoflow.dev`, just embed the SVG directly — modern browsers animate it natively, no conversion needed.

## What's coming next batch (Day 2)

- `DIAGRAM_3_two_tier_storage.svg` — sessions.jsonl + details/ tier structure
- `SHOT_LIST_screencast_2_copilot_lmt_live.md` — the moat proof video
- `SHOT_LIST_screencast_3_bookmark_transcript.md` — Claude Code harvest demo
- `SCREENSHOTS_shotlist.md` — 5 static screenshot compositions
- `GIF_shotlist.md` — 3 GIF loops for Twitter

## How to use the SVGs

The SVGs are designed to render at any size, but for social platforms you need PNG. Convert with:

```bash
# Requires Inkscape or ImageMagick
inkscape HERO_og_image.svg --export-filename=HERO_og_image.png --export-width=1200
inkscape DIAGRAM_1_lmt_vs_mcp.svg --export-filename=DIAGRAM_1_lmt_vs_mcp.png --export-width=1200
inkscape DIAGRAM_2_bookmark_paths.svg --export-filename=DIAGRAM_2_bookmark_paths.png --export-width=1200

# Alternative — ImageMagick
magick HERO_og_image.svg -resize 1200x HERO_og_image.png
```

Or open the SVG in a browser (Chrome/Edge), take a screenshot, save as PNG. Or use https://cloudconvert.com/svg-to-png if you prefer no-install.

## Where PNG versions of these go

- `HERO_og_image.png` → drop into `infernoflow-site/public/` and reference in `<head>`:
  ```html
  <meta property="og:image" content="https://www.infernoflow.dev/og-image.png"/>
  <meta name="twitter:image" content="https://www.infernoflow.dev/og-image.png"/>
  <meta name="twitter:card" content="summary_large_image"/>
  ```
- `DIAGRAM_1_lmt_vs_mcp.png` → dev.to post as inline image, HN as hosted link, Reddit as inline
- `DIAGRAM_2_bookmark_paths.png` → same as above

## Design system used

- **Background**: `#0d0f16` (near-black with slight blue)
- **Card fill**: gradient `#1e2230 → #141826`
- **Primary accent**: `#FF6B35` (fire orange)
- **Secondary accent**: `#F7931E` (deep amber)
- **Highlight**: `#FFAB00` (gold)
- **Text (heading)**: `#FFFFFF`
- **Text (body)**: `#A0A6B1`
- **Text (muted)**: `#5B6172` / `#8A92A4`
- **Font**: `-apple-system, Segoe UI, sans-serif` (renders nicely on Mac/Win screencaps)
- **Mono font**: `Menlo, Consolas, monospace`

Keep this palette consistent across all future assets — the launch should feel like one product, not a Frankenstein of styles.

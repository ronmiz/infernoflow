/**
 * infernoflow theme
 *
 * Scans the project for design tokens — fonts, colors, CSS variables —
 * and writes inferno/theme.json so AI agents always know the visual system.
 *
 * This captures what AI can't reliably infer from scattered style files:
 * the actual palette, typography, and spacing tokens in use.
 *
 * When theme.json changes between runs, the delta is auto-logged to sessions.jsonl
 * so agents know the design system evolved (not just the code).
 *
 * Usage:
 *   infernoflow theme             Scan + write inferno/theme.json
 *   infernoflow theme --show      Print current theme.json
 *   infernoflow theme --json      Output as JSON
 *   infernoflow theme --dry-run   Scan but don't write
 *   infernoflow theme --watch     Re-scan on style file changes
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { scanTheme }  from "../theme/scanner.mjs";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

const INFERNO_DIR  = "inferno";
const THEME_FILE   = path.join(INFERNO_DIR, "theme.json");
const SESSIONS_FILE = path.join(INFERNO_DIR, "sessions.jsonl");

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }

function appendSession(entry) {
  if (!fs.existsSync(SESSIONS_FILE)) return;
  fs.appendFileSync(SESSIONS_FILE, JSON.stringify(entry) + "\n", "utf8");
}

function diffTheme(prev, next) {
  const changes = [];

  // Font changes
  if (prev?.fonts?.primary !== next?.fonts?.primary) {
    changes.push(`primary font: ${prev?.fonts?.primary || "none"} → ${next?.fonts?.primary || "none"}`);
  }
  if (prev?.fonts?.mono !== next?.fonts?.mono) {
    changes.push(`mono font: ${prev?.fonts?.mono || "none"} → ${next?.fonts?.mono || "none"}`);
  }

  // Mode change
  if (prev?.colors?.mode !== next?.colors?.mode) {
    changes.push(`color mode: ${prev?.colors?.mode || "unknown"} → ${next?.colors?.mode}`);
  }

  // Palette changes
  const prevPalette = prev?.colors?.palette || {};
  const nextPalette = next?.colors?.palette || {};
  for (const key of new Set([...Object.keys(prevPalette), ...Object.keys(nextPalette)])) {
    if (prevPalette[key] !== nextPalette[key]) {
      changes.push(`${key} color: ${prevPalette[key] || "none"} → ${nextPalette[key] || "none"}`);
    }
  }

  // CSS var changes (new or changed vars only)
  const prevVars = prev?.cssVars || {};
  const nextVars = next?.cssVars || {};
  const newVars  = Object.keys(nextVars).filter(k => !prevVars[k]);
  const changedVars = Object.keys(nextVars).filter(k => prevVars[k] && prevVars[k] !== nextVars[k]);
  if (newVars.length)     changes.push(`new CSS vars: ${newVars.slice(0,5).join(", ")}`);
  if (changedVars.length) changes.push(`changed CSS vars: ${changedVars.slice(0,5).join(", ")}`);

  return changes;
}

function printTheme(theme) {
  const { fonts, colors, cssVars, framework, stats } = theme;

  console.log("\n  " + bold("🎨 Design System"));
  console.log("  " + "─".repeat(50));

  console.log(cyan("\n  Fonts"));
  if (fonts.primary) console.log(`    Primary   : ${fonts.primary}`);
  if (fonts.mono)    console.log(`    Mono      : ${fonts.mono}`);
  if (fonts.all?.length > 2) console.log(gray(`    All       : ${fonts.all.join(", ")}`));
  if (fonts.sources?.length) console.log(gray(`    Sources   : ${fonts.sources.join(", ")}`));

  console.log(cyan("\n  Colors") + gray(` (${colors.mode} mode)`));
  for (const [role, hex] of Object.entries(colors.palette)) {
    const swatch = `\x1b[48;2;${parseInt(hex.slice(1,3),16)};${parseInt(hex.slice(3,5),16)};${parseInt(hex.slice(5,7),16)}m   \x1b[0m`;
    console.log(`    ${role.padEnd(14)} ${swatch} ${hex}`);
  }

  if (Object.keys(cssVars).length) {
    console.log(cyan("\n  CSS Variables") + gray(` (${Object.keys(cssVars).length} found)`));
    const entries = Object.entries(cssVars).slice(0, 12);
    for (const [name, val] of entries) {
      console.log(`    ${name.padEnd(24)} ${gray(val)}`);
    }
    if (Object.keys(cssVars).length > 12) {
      console.log(gray(`    … and ${Object.keys(cssVars).length - 12} more`));
    }
  }

  console.log(cyan("\n  Framework") + `  ${framework}`);
  console.log(gray(`\n  Scanned: ${stats.styleFiles} style files · ${stats.colorsFound} colors · ${stats.varsFound} CSS vars\n`));
}

export async function themeCommand(args) {
  const has     = (f) => args.includes(f);
  const dryRun  = has("--dry-run");
  const showOnly = has("--show") || has("-s");
  const jsonFlag = has("--json");
  const watchFlag = has("--watch");

  console.log("\n  " + bold("🔥 infernoflow — theme"));
  console.log("  " + "─".repeat(50) + "\n");

  if (!fs.existsSync(INFERNO_DIR)) {
    console.error(red("  ✘ inferno/ not found — run: infernoflow init\n"));
    process.exit(1);
  }

  // ── Show existing theme ────────────────────────────────────────────────────
  if (showOnly) {
    const existing = readJSON(THEME_FILE);
    if (!existing) {
      console.log(yellow("  ⚠ No theme.json yet — run: infernoflow theme\n"));
      return;
    }
    if (jsonFlag) { console.log(JSON.stringify(existing, null, 2)); return; }
    printTheme(existing);
    return;
  }

  const runScan = () => {
    console.log(gray("  Scanning style files…"));
    const cwd = process.cwd();
    const theme = scanTheme(cwd);

    if (jsonFlag) { console.log(JSON.stringify(theme, null, 2)); return; }

    printTheme(theme);

    if (dryRun) {
      console.log(yellow("  ⚑ Dry run — theme.json not written\n"));
      return;
    }

    // Read previous theme to diff
    const prev = readJSON(THEME_FILE);

    const output = {
      ...theme,
      scannedAt: new Date().toISOString(),
    };

    fs.writeFileSync(THEME_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(green("  ✔ Written → inferno/theme.json\n"));

    // Auto-log changes to sessions.jsonl if theme changed
    if (prev) {
      const changes = diffTheme(prev, theme);
      if (changes.length) {
        appendSession({
          ts:      new Date().toISOString(),
          agent:   "infernoflow",
          type:    "theme",
          summary: "Theme changed: " + changes.join("; "),
        });
        console.log(yellow("  ⚡ Theme changes logged to sessions.jsonl"));
        for (const c of changes) console.log(gray(`     • ${c}`));
        console.log();
      }
    }
  };

  runScan();

  // ── Watch mode ─────────────────────────────────────────────────────────────
  if (watchFlag) {
    console.log(cyan("  Watching style files for changes… (Ctrl+C to stop)\n"));
    const { watch } = await import("node:fs");
    let debounce = null;
    watch(process.cwd(), { recursive: true }, (_, filename) => {
      if (!filename) return;
      const ext = path.extname(filename);
      if (![".css",".scss",".sass",".less",".styl"].includes(ext)) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        console.log(gray(`\n  Change detected: ${filename}`));
        runScan();
      }, 1000);
    });
    // Keep alive
    await new Promise(() => {});
  }
}

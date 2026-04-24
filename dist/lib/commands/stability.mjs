/**
 * infernoflow freeze / thaw / stability
 *
 * The solid/liquid layer — mark capabilities as frozen (don't touch),
 * stable (be careful), or experimental (feel free to reshape).
 *
 * Usage:
 *   infernoflow stability                     List all caps with stability level
 *   infernoflow freeze <cap-id>               Mark a capability as frozen
 *   infernoflow freeze <cap-id> --stable      Mark as stable (default middle tier)
 *   infernoflow thaw  <cap-id>                Reset to experimental
 *   infernoflow stability --json              Machine-readable output
 *
 * Levels:
 *   experimental  New or actively changing — AI may freely refactor
 *   stable        Settled API — AI should be careful, prefer additive changes
 *   frozen        Core contract — AI must never modify without explicit instruction
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── constants ─────────────────────────────────────────────────────────────────

export const LEVELS = ["experimental", "stable", "frozen"];

const LEVEL_ICON = {
  experimental: "🌊",   // liquid — flows freely
  stable:       "〰️",   // semi-fluid — treat with care
  frozen:       "🧊",   // solid — do not touch
};

const LEVEL_COLOR = {
  experimental: green,
  stable:       yellow,
  frozen:       red,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function loadCaps(capsPath) {
  try {
    const data = JSON.parse(fs.readFileSync(capsPath, "utf8"));
    return Array.isArray(data) ? data : (data.capabilities || []);
  } catch (e) {
    console.error(red("✗ Failed to read capabilities.json: " + e.message));
    process.exit(1);
  }
}

function saveCaps(capsPath, caps) {
  fs.writeFileSync(capsPath, JSON.stringify(caps, null, 2));
}

function getLevel(cap) {
  return cap.stability || "experimental";
}

function bar(level) {
  const idx   = LEVELS.indexOf(level);
  const color = LEVEL_COLOR[level] || gray;
  const filled = "█".repeat(idx + 1);
  const empty  = "░".repeat(LEVELS.length - idx - 1);
  return color(filled) + gray(empty);
}

// ── sub-commands ──────────────────────────────────────────────────────────────

function cmdList(caps, jsonMode) {
  if (jsonMode) {
    const out = caps.map(c => ({ id: c.id, name: c.name || c.title, stability: getLevel(c) }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const byLevel = { frozen: [], stable: [], experimental: [] };
  for (const cap of caps) byLevel[getLevel(cap)].push(cap);

  console.log();
  console.log(bold("  Capability Stability"));
  console.log(gray("  ───────────────────────────────────────────────────────────"));
  console.log(
    gray("  ") + bold(cyan("Capability".padEnd(32))) +
    bold(cyan("Level".padEnd(16))) + bold(cyan("Solid/Liquid"))
  );
  console.log(gray("  ───────────────────────────────────────────────────────────"));

  for (const cap of caps) {
    const level = getLevel(cap);
    const icon  = LEVEL_ICON[level];
    const color = LEVEL_COLOR[level] || gray;
    console.log(
      `  ${icon}  ${cap.id.padEnd(30)} ${color(level.padEnd(14))} ${bar(level)}`
    );
  }

  console.log(gray("  ───────────────────────────────────────────────────────────"));
  console.log();

  const counts = {
    frozen:       byLevel.frozen.length,
    stable:       byLevel.stable.length,
    experimental: byLevel.experimental.length,
  };
  console.log(
    `  ${red("🧊 Frozen:")} ${counts.frozen}   ` +
    `${yellow("〰️  Stable:")} ${counts.stable}   ` +
    `${green("🌊 Experimental:")} ${counts.experimental}`
  );
  console.log();
  console.log(gray("  Tip: infernoflow freeze <cap-id>   —   infernoflow thaw <cap-id>"));
  console.log();
}

function cmdFreeze(caps, capsPath, capId, level) {
  if (!LEVELS.includes(level)) {
    console.error(red(`✗ Invalid level "${level}". Must be: ${LEVELS.join(", ")}`));
    process.exit(1);
  }

  const idx = caps.findIndex(c => c.id === capId);
  if (idx === -1) {
    console.error(red(`✗ Capability "${capId}" not found in capabilities.json`));
    process.exit(1);
  }

  const prev  = getLevel(caps[idx]);
  caps[idx]   = { ...caps[idx], stability: level, stabilitySetAt: new Date().toISOString() };
  saveCaps(capsPath, caps);

  const icon  = LEVEL_ICON[level];
  const color = LEVEL_COLOR[level];
  console.log();
  console.log(`  ${icon}  ${bold(capId)}  ${gray(prev)} → ${color(level)}`);
  if (level === "frozen") {
    console.log(gray("  AI assistants will be instructed not to modify this capability."));
    console.log(gray("  Run `infernoflow setup` to update CLAUDE.md with this change."));
  }
  console.log();
}

function cmdThaw(caps, capsPath, capId) {
  const idx = caps.findIndex(c => c.id === capId);
  if (idx === -1) {
    console.error(red(`✗ Capability "${capId}" not found in capabilities.json`));
    process.exit(1);
  }

  const prev  = getLevel(caps[idx]);
  caps[idx]   = { ...caps[idx], stability: "experimental", stabilitySetAt: new Date().toISOString() };
  saveCaps(capsPath, caps);

  console.log();
  console.log(`  🌊  ${bold(capId)}  ${gray(prev)} → ${green("experimental")}`);
  console.log(gray("  This capability is now liquid — free to evolve."));
  console.log();
}

// ── scan drift check (frozen caps whose files changed) ────────────────────────

export function checkFrozenDrift(infernoDir, cwd) {
  const capsPath  = path.join(infernoDir, "capabilities.json");
  const scanPath  = path.join(infernoDir, "scan.json");
  if (!fs.existsSync(capsPath) || !fs.existsSync(scanPath)) return [];

  const caps = loadCaps(capsPath);
  const scan = JSON.parse(fs.readFileSync(scanPath, "utf8"));
  const scannedAt = new Date(scan.scannedAt);

  const warnings = [];
  for (const cap of caps) {
    if (getLevel(cap) !== "frozen") continue;
    const scanEntry = scan.capabilities?.find(c => c.id === cap.id);
    if (!scanEntry?.codeAnalysis?.sourceFiles) continue;

    for (const relFile of scanEntry.codeAnalysis.sourceFiles) {
      const absFile = path.join(cwd, relFile);
      try {
        const stat = fs.statSync(absFile);
        if (stat.mtimeMs > scannedAt.getTime()) {
          warnings.push({ capId: cap.id, file: relFile });
        }
      } catch {}
    }
  }
  return warnings;
}

// ── stability summary for CLAUDE.md ──────────────────────────────────────────

export function buildStabilitySummary(caps) {
  const frozen       = caps.filter(c => getLevel(c) === "frozen").map(c => c.id);
  const stable       = caps.filter(c => getLevel(c) === "stable").map(c => c.id);
  const experimental = caps.filter(c => getLevel(c) === "experimental").map(c => c.id);

  if (frozen.length === 0 && stable.length === 0) return null;

  const lines = ["### Capability Stability (Solid/Liquid Layer)", ""];

  if (frozen.length > 0) {
    lines.push("**🧊 Frozen — NEVER modify without explicit instruction:**");
    for (const id of frozen) lines.push(`- \`${id}\``);
    lines.push("");
  }
  if (stable.length > 0) {
    lines.push("**〰️ Stable — prefer additive changes, avoid breaking API:**");
    for (const id of stable) lines.push(`- \`${id}\``);
    lines.push("");
  }
  if (experimental.length > 0) {
    lines.push(`**🌊 Experimental — free to refactor:** ${experimental.map(id => `\`${id}\``).join(", ")}`);
    lines.push("");
  }

  lines.push("> Run `infernoflow stability` to see the full liquid/solid map.");
  return lines.join("\n");
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function stabilityCommand(rawArgs) {
  const args    = (rawArgs || []).slice(1); // skip command name
  const jsonMode = args.includes("--json");
  const cwd      = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const capsPath   = path.join(infernoDir, "capabilities.json");

  if (!fs.existsSync(capsPath)) {
    console.error(red("✗ inferno/capabilities.json not found — run `infernoflow init` first."));
    process.exit(1);
  }

  const caps = loadCaps(capsPath);
  cmdList(caps, jsonMode);

  // Also check for frozen drift if scan.json exists
  const driftWarnings = checkFrozenDrift(infernoDir, cwd);
  if (driftWarnings.length > 0) {
    console.log(red("  ⚠  Frozen capability drift detected!"));
    for (const w of driftWarnings) {
      console.log(red(`     ${w.capId}: ${w.file} was modified since last scan`));
    }
    console.log(gray("  Run `infernoflow scan` to update the baseline."));
    console.log();
  }
}

export async function freezeCommand(rawArgs) {
  const args    = (rawArgs || []).slice(1); // skip command name
  const capId   = args.find(a => !a.startsWith("--"));
  const isStable = args.includes("--stable");
  const level   = isStable ? "stable" : "frozen";

  if (!capId) {
    console.error(red("✗ Usage: infernoflow freeze <capability-id> [--stable]"));
    process.exit(1);
  }

  const cwd      = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const capsPath   = path.join(infernoDir, "capabilities.json");

  if (!fs.existsSync(capsPath)) {
    console.error(red("✗ inferno/capabilities.json not found."));
    process.exit(1);
  }

  const caps = loadCaps(capsPath);
  cmdFreeze(caps, capsPath, capId, level);
}

export async function thawCommand(rawArgs) {
  const args  = (rawArgs || []).slice(1); // skip command name
  const capId = args.find(a => !a.startsWith("--"));

  if (!capId) {
    console.error(red("✗ Usage: infernoflow thaw <capability-id>"));
    process.exit(1);
  }

  const cwd      = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const capsPath   = path.join(infernoDir, "capabilities.json");

  if (!fs.existsSync(capsPath)) {
    console.error(red("✗ inferno/capabilities.json not found."));
    process.exit(1);
  }

  const caps = loadCaps(capsPath);
  cmdThaw(caps, capsPath, capId);
}

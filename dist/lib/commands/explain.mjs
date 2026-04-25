/**
 * infernoflow explain
 *
 * AI-generated narrative about a capability — what it does, why it exists,
 * what's risky about it, and what to test before changing it.
 *
 * Synthesises: stability level, git history, scenarios, callers, services,
 * source files — then calls the AI provider for a 3-5 sentence human narrative.
 *
 * Usage:
 *   infernoflow explain user-auth
 *   infernoflow explain payment-process --dry-run    (print prompt only)
 *   infernoflow explain user-auth --json
 */

import * as fs      from "node:fs";
import * as path    from "node:path";
import { execSync } from "node:child_process";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return null; }
}

function runGit(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe","pipe","pipe"] }).trim();
  } catch { return ""; }
}

const LEVEL_ICON  = { frozen: "🧊", stable: "〰️ ", experimental: "🌊" };
const LEVEL_COLOR = { frozen: red, stable: yellow, experimental: green };

function stability(cap) { return cap?.stability || "experimental"; }

// ── git helpers ───────────────────────────────────────────────────────────────

function getFirstCommit(filePath, cwd) {
  if (!filePath) return null;
  const rel = path.relative(cwd, path.resolve(cwd, filePath));
  const log = runGit(
    `git log --follow --format="%h|%aI|%ae|%s" -- ${JSON.stringify(rel)}`, cwd
  );
  if (!log) return null;
  const lines = log.split("\n").filter(Boolean);
  if (!lines.length) return null;
  const [hash, date, author, ...subjectParts] = lines[lines.length - 1].split("|");
  return {
    hash:    hash?.trim(),
    date:    date?.trim() ? new Date(date.trim()).toLocaleDateString() : "",
    author:  author?.trim(),
    subject: subjectParts.join("|").trim(),
  };
}

function getRecentHistory(filePath, cwd, limit = 5) {
  if (!filePath) return [];
  const rel = path.relative(cwd, path.resolve(cwd, filePath));
  const log = runGit(
    `git log --follow --format="%h|%aI|%ae|%s" -${limit} -- ${JSON.stringify(rel)}`, cwd
  );
  if (!log) return [];
  return log.split("\n").filter(Boolean).map(line => {
    const [hash, date, author, ...subjectParts] = line.split("|");
    return {
      hash:    hash?.trim(),
      date:    date?.trim() ? new Date(date.trim()).toLocaleDateString() : "",
      author:  author?.trim(),
      subject: subjectParts.join("|").trim(),
    };
  });
}

// ── scenario finder ───────────────────────────────────────────────────────────

function findScenarios(capId, infernoDir) {
  const dir = path.join(infernoDir, "scenarios");
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      const covered = s.capabilitiesCovered || s.capabilities || [];
      if (covered.some(c => c.toLowerCase() === capId.toLowerCase())) {
        found.push(s);
      }
    } catch {}
  }
  return found;
}

// ── prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(capId, cap, scanEntry, graph, allCaps, scenarios, firstCommit, recentHistory) {
  const level      = stability(cap);
  const files      = scanEntry?.codeAnalysis?.sourceFiles   || [];
  const functions  = scanEntry?.codeAnalysis?.functions     || [];
  const services   = scanEntry?.codeAnalysis?.services      || [];
  const throws_    = scanEntry?.codeAnalysis?.throws        || [];
  const calls      = scanEntry?.codeAnalysis?.calls         || [];
  const deps       = graph?.deps?.[capId]       || [];
  const dependents = graph?.dependents?.[capId] || [];

  const lines = [
    `You are a senior engineer writing a brief, plain-English explanation of a software capability for a teammate who is about to modify it.`,
    ``,
    `Write 3–5 sentences covering:`,
    `  1. What this capability does and why it exists`,
    `  2. The most important thing to know before changing it (stability, callers, risk)`,
    `  3. What to test or verify after any modification`,
    ``,
    `Be concrete and direct. Do not use bullet points. Do not repeat the capability ID verbatim in every sentence.`,
    ``,
    `=== Capability: ${capId} ===`,
    `Name:        ${cap.name || cap.title || capId}`,
    `Description: ${cap.description || "(none provided)"}`,
    `Stability:   ${level}`,
  ];

  if (files.length)     lines.push(`Source files: ${files.join(", ")}`);
  if (functions.length) lines.push(`Functions:    ${functions.join(", ")}`);
  if (services.length)  lines.push(`External services used: ${services.join(", ")}`);
  if (throws_.length)   lines.push(`Can throw: ${throws_.join(", ")}`);
  if (calls.length)     lines.push(`Internal calls: ${calls.join(", ")}`);

  if (deps.length) {
    const depDetails = deps.map(d => {
      const dc = allCaps.find(c => c.id === d);
      return `${d} (${stability(dc)})`;
    });
    lines.push(`Calls capabilities: ${depDetails.join(", ")}`);
  }

  if (dependents.length) {
    const depDetails = dependents.map(d => {
      const dc = allCaps.find(c => c.id === d);
      return `${d} (${stability(dc)})`;
    });
    lines.push(`Called by capabilities: ${depDetails.join(", ")}`);
  }

  if (scenarios.length) {
    lines.push(`Test scenarios: ${scenarios.map(s => s.scenarioId || s.description || "unnamed").join(", ")}`);
  } else {
    lines.push(`Test scenarios: none registered`);
  }

  if (firstCommit) {
    lines.push(`First introduced: ${firstCommit.date} by ${firstCommit.author} — "${firstCommit.subject}"`);
  }

  if (recentHistory.length) {
    lines.push(`Recent changes:`);
    for (const h of recentHistory.slice(0, 3)) {
      lines.push(`  ${h.date} — ${h.subject}`);
    }
  }

  if (level === "frozen") {
    lines.push(`IMPORTANT: This capability is FROZEN. Any modification requires explicit approval.`);
  } else if (level === "stable") {
    lines.push(`NOTE: This capability is STABLE. Prefer additive changes; avoid breaking the public API.`);
  }

  return lines.join("\n");
}

// ── AI caller ─────────────────────────────────────────────────────────────────

async function callAI(prompt, cwd) {
  try {
    const { callAI: call } = await import("../ai/providerRouter.mjs");
    return await call(prompt, cwd);
  } catch {
    // Provider not available — return a structured fallback
    return null;
  }
}

// ── fallback narrative (no AI) ────────────────────────────────────────────────

function buildFallback(capId, cap, scanEntry, graph, allCaps, scenarios) {
  const level      = stability(cap);
  const name       = cap.name || cap.title || capId;
  const services   = scanEntry?.codeAnalysis?.services || [];
  const dependents = graph?.dependents?.[capId] || [];
  const deps       = graph?.deps?.[capId]       || [];

  const parts = [];

  // What it does
  if (cap.description && cap.description !== "(none provided)") {
    parts.push(`${name} — ${cap.description}.`);
  } else {
    parts.push(`${name} handles the ${capId} flow within this system.`);
  }

  // External services
  if (services.length) {
    parts.push(`It integrates with ${services.join(" and ")}.`);
  }

  // Dependencies
  if (deps.length) {
    parts.push(`It depends on: ${deps.join(", ")}.`);
  }
  if (dependents.length) {
    const frozenDeps = dependents.filter(d => stability(allCaps.find(c => c.id === d)) === "frozen");
    if (frozenDeps.length) {
      parts.push(`⚠️  ${frozenDeps.join(", ")} depend${frozenDeps.length === 1 ? "s" : ""} on this — changing it may break frozen capabilities.`);
    } else {
      parts.push(`${dependents.join(", ")} depend${dependents.length === 1 ? "s" : ""} on this capability.`);
    }
  }

  // Stability advice
  if (level === "frozen") {
    parts.push(`This capability is FROZEN — do not modify without explicit instruction.`);
  } else if (level === "stable") {
    parts.push(`This capability is stable — prefer additive changes and avoid breaking the existing API surface.`);
  } else {
    parts.push(`This capability is experimental — free to refactor as needed.`);
  }

  // Test advice
  if (scenarios.length) {
    parts.push(`Before shipping changes, run the registered scenarios: ${scenarios.map(s => s.scenarioId || "unnamed").join(", ")}.`);
  } else {
    parts.push(`No test scenarios are registered — consider adding one before making changes.`);
  }

  return parts.join(" ");
}

// ── printer ───────────────────────────────────────────────────────────────────

function printExplain(capId, cap, narrative, provider, dryRun) {
  const level = stability(cap);
  const icon  = LEVEL_ICON[level]  || "🌊";
  const color = LEVEL_COLOR[level] || green;

  console.log();
  console.log(bold(`  ${icon} ${color(capId)}`));
  if (cap.name || cap.title) console.log(gray(`     ${cap.name || cap.title}`));
  console.log();

  if (dryRun) {
    console.log(yellow("  [dry-run] Prompt only — no AI call made"));
    console.log();
    return;
  }

  // Word-wrap narrative at ~80 chars
  const words  = narrative.split(" ");
  let   line   = "  ";
  const lines  = [];
  for (const word of words) {
    if (line.length + word.length > 82) { lines.push(line); line = "  " + word; }
    else line += (line === "  " ? "" : " ") + word;
  }
  if (line.trim()) lines.push(line);

  for (const l of lines) console.log(l);
  console.log();

  if (provider) {
    console.log(gray(`  ── via ${provider}`));
  } else {
    console.log(gray("  ── structural summary (no AI provider configured)"));
    console.log(`  ${yellow("💡")} ${gray("For richer AI narratives:")}  ${cyan("infernoflow ai setup")}`);
  }
  console.log();
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function explainCommand(rawArgs) {
  const args    = (rawArgs || []).slice(1);
  const dryRun  = args.includes("--dry-run");
  const jsonMode = args.includes("--json");

  const capId = args.find(a => !a.startsWith("--"));

  if (!capId) {
    console.error(red("✗ Usage: infernoflow explain <capability-id> [--dry-run] [--json]"));
    console.error(gray("  Example: infernoflow explain user-auth"));
    process.exit(1);
  }

  const cwd        = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  // Load capabilities
  let allCaps = [];
  const rawCaps = loadJson(path.join(infernoDir, "capabilities.json"));
  if (rawCaps) allCaps = Array.isArray(rawCaps) ? rawCaps : (rawCaps.capabilities || []);

  const cap = allCaps.find(c => c.id === capId);
  if (!cap) {
    console.error(red(`✗ Capability "${capId}" not found in capabilities.json`));
    console.error(gray("  Run: infernoflow stability — to list all capability IDs"));
    process.exit(1);
  }

  // Load scan + graph
  const scanData  = loadJson(path.join(infernoDir, "scan.json"));
  const graph     = loadJson(path.join(infernoDir, "graph.json"));
  const scanEntry = scanData?.capabilities?.find(c => c.id === capId);

  // Git history
  const files       = scanEntry?.codeAnalysis?.sourceFiles || [];
  const firstCommit = getFirstCommit(files[0], cwd);
  const recentHistory = getRecentHistory(files[0], cwd);

  // Scenarios
  const scenarios = findScenarios(capId, infernoDir);

  // Build prompt
  const prompt = buildPrompt(capId, cap, scanEntry, graph, allCaps, scenarios, firstCommit, recentHistory);

  if (dryRun && !jsonMode) {
    console.log(gray(`\n  infernoflow explain  →  ${bold(capId)}`));
    console.log(gray("  ──────────────────────────────────────────────────────────────"));
    printExplain(capId, cap, "", null, true);
    console.log(bold("  Prompt that would be sent to AI:"));
    console.log();
    console.log(prompt.split("\n").map(l => "    " + l).join("\n"));
    console.log();
    return;
  }

  // Call AI
  let narrative = null;
  let provider  = null;

  if (!dryRun) {
    try {
      const result = await callAI(prompt, cwd);
      if (result?.text) {
        narrative = result.text.trim();
        provider  = result.provider;
      }
    } catch {}
  }

  // Fallback if no AI
  if (!narrative) {
    narrative = buildFallback(capId, cap, scanEntry, graph, allCaps, scenarios);
    provider  = null;
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      capId,
      name:      cap.name || cap.title,
      stability: stability(cap),
      narrative,
      provider:  provider || "fallback",
      sourceFiles: files,
      scenarios:   scenarios.map(s => s.scenarioId || s.description),
      firstCommit,
    }, null, 2));
    return;
  }

  console.log(gray(`\n  infernoflow explain  →  ${bold(capId)}`));
  console.log(gray("  ──────────────────────────────────────────────────────────────"));
  printExplain(capId, cap, narrative, provider, false);
}

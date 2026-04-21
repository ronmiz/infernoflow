/**
 * infernoflow diff
 *
 * Compare capabilities between the current working tree and a git ref.
 * Defaults to the most recent git tag; falls back to HEAD~1 if no tags exist.
 *
 * Usage:
 *   infernoflow diff                  # vs last tag
 *   infernoflow diff --ref v0.10.18   # vs specific tag / commit
 *   infernoflow diff --ref HEAD~5     # vs 5 commits ago
 *   infernoflow diff --json           # machine-readable output
 *   infernoflow diff --summary        # one-liner count only
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { header, ok, fail, warn, info, bold, cyan, gray, green, red, yellow } from "../ui/output.mjs";

// ── git helpers ──────────────────────────────────────────────────────────────

function capture(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function lastTag(cwd) {
  // Try to find the most recent reachable tag
  const tag = capture("git describe --tags --abbrev=0", cwd);
  if (tag) return tag;
  return null;
}

function fileAtRef(ref, relPath, cwd) {
  // Returns file content at a git ref, or null if not found
  const content = capture(`git show "${ref}:${relPath}"`, cwd);
  return content;
}

function currentBranch(cwd) {
  return capture("git rev-parse --abbrev-ref HEAD", cwd) || "HEAD";
}

function refDescription(cwd, ref) {
  // Human label: "v0.10.18 (2026-04-10)" or "HEAD~1"
  const date = capture(`git log -1 --format=%ci "${ref}"`, cwd);
  const short = date ? date.slice(0, 10) : null;
  return short ? `${ref}  ${gray("(" + short + ")")}` : ref;
}

// ── capability helpers ───────────────────────────────────────────────────────

function parseCaps(jsonText) {
  // Accepts capabilities.json OR contract.json — both have a "capabilities" array
  if (!jsonText) return null;
  try {
    const obj = JSON.parse(jsonText);
    const raw = obj.capabilities || [];
    // capabilities.json: array of objects { id, title, ... }
    // contract.json: array of id strings
    return raw.map(c => {
      if (typeof c === "string") return { id: c, title: c };
      return { id: c.id || c, title: c.title || c.id || String(c), since: c.since, status: c.status };
    });
  } catch {
    return null;
  }
}

function loadCapsAtRef(ref, infernoRelDir, cwd) {
  // Try capabilities.json first, fall back to contract.json
  const capsJson = fileAtRef(ref, `${infernoRelDir}/capabilities.json`, cwd);
  if (capsJson) return parseCaps(capsJson);
  const contractJson = fileAtRef(ref, `${infernoRelDir}/contract.json`, cwd);
  return parseCaps(contractJson);
}

function loadCapsFromDisk(infernoDir) {
  const capsPath = path.join(infernoDir, "capabilities.json");
  const contractPath = path.join(infernoDir, "contract.json");
  if (fs.existsSync(capsPath)) {
    return parseCaps(fs.readFileSync(capsPath, "utf8"));
  }
  if (fs.existsSync(contractPath)) {
    return parseCaps(fs.readFileSync(contractPath, "utf8"));
  }
  return null;
}

// ── diff logic ───────────────────────────────────────────────────────────────

function diffCaps(before, after) {
  const beforeMap = new Map(before.map(c => [c.id, c]));
  const afterMap  = new Map(after.map(c  => [c.id, c]));

  const added   = after.filter(c  => !beforeMap.has(c.id));
  const removed = before.filter(c => !afterMap.has(c.id));

  const changed = [];
  for (const c of after) {
    const old = beforeMap.get(c.id);
    if (!old) continue;
    const changes = [];
    if (old.title !== c.title) changes.push({ field: "title", from: old.title, to: c.title });
    if (old.status !== c.status && (old.status || c.status)) changes.push({ field: "status", from: old.status || "—", to: c.status || "—" });
    if (changes.length) changed.push({ id: c.id, changes });
  }

  return { added, removed, changed };
}

// ── rendering ────────────────────────────────────────────────────────────────

function renderAdded(caps) {
  if (!caps.length) return;
  console.log(`\n  ${bold(green("+ Added"))}  ${gray("(" + caps.length + ")")}`);
  for (const c of caps) {
    const since = c.since ? gray("  since " + c.since) : "";
    console.log(`    ${green("+")} ${bold(c.id)}  ${gray(c.title)}${since}`);
  }
}

function renderRemoved(caps) {
  if (!caps.length) return;
  console.log(`\n  ${bold(red("- Removed"))}  ${gray("(" + caps.length + ")")}`);
  for (const c of caps) {
    console.log(`    ${red("-")} ${bold(c.id)}  ${gray(c.title)}`);
  }
}

function renderChanged(items) {
  if (!items.length) return;
  console.log(`\n  ${bold(yellow("~ Changed"))}  ${gray("(" + items.length + ")")}`);
  for (const item of items) {
    console.log(`    ${yellow("~")} ${bold(item.id)}`);
    for (const ch of item.changes) {
      console.log(`        ${gray(ch.field + ":")}  ${red(ch.from)}  →  ${green(ch.to)}`);
    }
  }
}

function renderUnchanged(count) {
  if (count === 0) return;
  console.log(`\n  ${gray("  Unchanged  " + count)}`);
}

function renderSummaryLine(result, refLabel) {
  const parts = [];
  if (result.added.length)   parts.push(green("+" + result.added.length + " added"));
  if (result.removed.length) parts.push(red("-" + result.removed.length + " removed"));
  if (result.changed.length) parts.push(yellow("~" + result.changed.length + " changed"));
  if (!parts.length)         parts.push(gray("no changes"));
  console.log(`  ${parts.join("  ")}  ${gray("vs " + refLabel)}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function diffCommand(rawArgs) {
  const args = rawArgs.slice(1);

  const asJson   = args.includes("--json");
  const summary  = args.includes("--summary");

  const refIdx = args.indexOf("--ref");
  let ref = refIdx !== -1 ? args[refIdx + 1] : null;

  const cwd       = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const infernoRelDir = "inferno"; // relative for git show

  if (!asJson) header("diff");

  // ── Validate inferno/ exists ─────────────────────────────────────────────
  if (!fs.existsSync(infernoDir)) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: "inferno_not_found" }));
      process.exit(1);
    }
    fail("inferno/ not found", "Run: infernoflow init");
    process.exit(1);
  }

  // ── Resolve ref ──────────────────────────────────────────────────────────
  if (!ref) {
    ref = lastTag(cwd);
    if (!ref) {
      // No tags — fall back to HEAD~1
      const parentExists = capture("git rev-parse HEAD~1", cwd);
      if (parentExists) {
        ref = "HEAD~1";
      } else {
        if (asJson) {
          console.log(JSON.stringify({ ok: false, error: "no_ref", hint: "No git tags found and no parent commit. Use --ref <commit>" }));
          process.exit(1);
        }
        fail("No git tags found", "Create a tag first: git tag v0.1.0  or use --ref <commit>");
        process.exit(1);
      }
    }
  }

  // ── Load capabilities ────────────────────────────────────────────────────
  const current = loadCapsFromDisk(infernoDir);
  if (!current) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: "no_capabilities_found" }));
      process.exit(1);
    }
    fail("No capabilities.json or contract.json found in inferno/");
    process.exit(1);
  }

  const previous = loadCapsAtRef(ref, infernoRelDir, cwd);
  if (!previous) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: "ref_not_found", ref, hint: "Does inferno/capabilities.json exist at that ref?" }));
      process.exit(1);
    }
    fail(`Could not read capabilities at ${ref}`, "The inferno/ directory may not exist at that ref");
    process.exit(1);
  }

  // ── Compute diff ─────────────────────────────────────────────────────────
  const result = diffCaps(previous, current);
  const unchanged = current.length - result.added.length - result.changed.length;

  // ── JSON output ──────────────────────────────────────────────────────────
  if (asJson) {
    console.log(JSON.stringify({
      ok: true,
      ref,
      current: current.length,
      previous: previous.length,
      added:   result.added,
      removed: result.removed,
      changed: result.changed,
      unchanged,
    }, null, 2));
    return;
  }

  // ── Human output ─────────────────────────────────────────────────────────
  const refLabel = refDescription(cwd, ref);
  console.log();
  console.log(`  Comparing ${bold(cyan("current"))}  vs  ${bold(refLabel)}`);
  console.log(`  ${gray(current.length + " capabilities now  /  " + previous.length + " before")}`);

  if (summary) {
    renderSummaryLine(result, ref);
    console.log();
    return;
  }

  const hasAny = result.added.length || result.removed.length || result.changed.length;

  if (!hasAny) {
    console.log();
    ok("No capability changes since " + ref);
    console.log();
    return;
  }

  renderAdded(result.added);
  renderRemoved(result.removed);
  renderChanged(result.changed);
  renderUnchanged(unchanged);

  console.log();
  renderSummaryLine(result, ref);
  console.log();
}

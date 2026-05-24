/**
 * infernoflow amp
 *
 * AI Memory Protocol subsystem — status, migrate from legacy inferno/, validate
 * against the spec, print conformance.
 *
 * Verbs:
 *   infernoflow amp                 Print conformance + layout state
 *   infernoflow amp status          Same as default
 *   infernoflow amp migrate         Copy inferno/sessions.jsonl → .ai-memory/sessions.jsonl
 *   infernoflow amp validate        Schema-check every entry in sessions.jsonl
 *   infernoflow amp version         Print AMP spec version (1.0)
 *
 * The protocol spec is at docs/protocol/PROTOCOL.md.
 * The reference TypeScript impl is at docs/protocol/src/amp.ts (publishable as @amp/core).
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";
import {
  AMP_VERSION,
  ampPaths,
  readEntries as ampRead,
  migrateLegacy,
} from "../amp/io.mjs";

// ── Lightweight schema check (no external deps) ──────────────────────────────

const AMP_TYPES = new Set(["gotcha", "decision", "attempt", "note", "detection", "pattern"]);
const AMP_TOOLS = new Set(["copilot", "cursor", "claude", "windsurf", "other"]);

function validateAmpEntry(entry, lineNumber) {
  const errs = [];
  if (!entry || typeof entry !== "object") errs.push("not an object");
  if (!entry.type) errs.push("missing required field: type");
  else if (!AMP_TYPES.has(entry.type)) errs.push(`type "${entry.type}" not in AMP enum`);
  if (!entry.msg) errs.push("missing required field: msg");
  else if (typeof entry.msg !== "string") errs.push("msg must be a string");
  else if (entry.msg.length > 500) errs.push(`msg too long (${entry.msg.length} > 500)`);
  if (entry.ts == null) errs.push("missing required field: ts");
  else if (typeof entry.ts !== "number" || !Number.isFinite(entry.ts)) errs.push("ts must be a Unix-ms integer");
  if (entry.id && !/^amp_[0-9A-Z]{26}$/.test(entry.id)) errs.push(`id "${entry.id}" not in amp_ULID format`);
  if (entry.tool && !AMP_TOOLS.has(entry.tool)) errs.push(`tool "${entry.tool}" not in AMP enum`);
  if (entry.confidence != null && (entry.confidence < 0 || entry.confidence > 1)) errs.push("confidence out of range [0,1]");
  return errs;
}

/**
 * Walk every JSONL memory file under .ai-memory/ (legacy sessions.jsonl,
 * global.jsonl, branches/*.jsonl) and return a flat list of parsed entries
 * tagged with their source file + line number. Validate uses the line+file
 * to report errors like "branches/main.jsonl:42 missing required field".
 *
 * Previously only read ampPaths(cwd).sessions — bypassed the v0.44 branch-
 * aware layout, so any malformed entry in a branch file went unflagged.
 */
function readRawEntries(cwd) {
  const p = ampPaths(cwd);
  const candidates = [
    p.sessions,           // legacy flat
    p.globalFile,         // personal preferences
    p.currentBranchFile,  // current branch
    p.defaultBranchFile,  // main/master
  ];
  // De-dupe (current == default on main, etc.); skip null defaultBranchFile.
  const files = [...new Set(candidates.filter(Boolean))];
  // Also pick up any other branch files that exist on disk — e.g. if the
  // user already worked on multiple branches, those JSONLs should be
  // validated too. Best-effort dir scan.
  try {
    if (fs.existsSync(p.branchesDir)) {
      for (const name of fs.readdirSync(p.branchesDir)) {
        if (!name.endsWith(".jsonl")) continue;
        const full = path.join(p.branchesDir, name);
        if (!files.includes(full)) files.push(full);
      }
    }
  } catch { /* unreadable dir is fine */ }

  const entries = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let lines;
    try { lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean); }
    catch { continue; }
    lines.forEach((l, i) => {
      try { entries.push({ ok: true,  file, line: i + 1, value: JSON.parse(l) }); }
      catch (err) { entries.push({ ok: false, file, line: i + 1, value: null, error: err.message }); }
    });
  }
  // Keep the legacy `sessions` field for status-printing back-compat in
  // doValidate — first-file is what gets shown when entries.length === 0.
  return { sessions: p.sessions, entries, lines: [], files };
}

// ── Verbs ────────────────────────────────────────────────────────────────────

function doStatus(cwd) {
  const { sessions, isAmp, root } = ampPaths(cwd);
  const ampDir    = path.join(cwd, ".ai-memory");
  const legacyDir = path.join(cwd, "inferno");
  const ampPresent    = fs.existsSync(ampDir);
  const legacyPresent = fs.existsSync(legacyDir) && fs.existsSync(path.join(legacyDir, "sessions.jsonl"));

  console.log();
  console.log(`  ${bold("🔥 infernoflow amp")} ${gray("— AI Memory Protocol status")}`);
  console.log();
  console.log(`  Spec version       ${bold(AMP_VERSION)}`);
  console.log(`  Conformance level  ${bold("AMP Full")} ${gray("(read + write + handoff + injection)")}`);
  console.log();

  if (!ampPresent && !legacyPresent) {
    console.log(`  ${yellow("⚠")} ${gray("Project not initialised — run:")} ${cyan("infernoflow init")}`);
    console.log();
    return;
  }

  console.log(`  ${bold("Layout:")}`);
  console.log(`    .ai-memory/  ${ampPresent    ? green("✔ present") + (isAmp ? gray(" (active)") : "") : gray("—")}`);
  console.log(`    inferno/     ${legacyPresent ? yellow("⚠ legacy")  + (isAmp ? "" : gray(" (active)")) : gray("—")}`);
  console.log();

  if (fs.existsSync(sessions)) {
    const entries = ampRead(cwd);
    console.log(`  ${bold("Memory:")}`);
    console.log(`    file        ${gray(path.relative(cwd, sessions))}`);
    console.log(`    entries     ${bold(String(entries.length))}`);
    if (entries.length) {
      const types = new Map();
      for (const e of entries) types.set(e.type, (types.get(e.type) || 0) + 1);
      const breakdown = [...types.entries()].map(([t, n]) => `${t}:${n}`).join("  ");
      console.log(`    breakdown   ${gray(breakdown)}`);
    }
  }

  if (legacyPresent && !ampPresent) {
    console.log();
    console.log(`  ${gray("Tip:")} ${cyan("infernoflow amp migrate")} ${gray("copies legacy memory into the AMP layout.")}`);
  }
  console.log();
}

function doMigrate(cwd) {
  console.log();
  console.log(`  ${bold("🔥 infernoflow amp migrate")}`);
  console.log();
  const result = migrateLegacy(cwd);
  if (result.migrated > 0) {
    console.log(`  ${green("✔")} Migrated ${bold(String(result.migrated))} entr${result.migrated === 1 ? "y" : "ies"} → ${cyan(".ai-memory/sessions.jsonl")}`);
    console.log(`  ${gray("The original inferno/sessions.jsonl is untouched. See .ai-memory/MIGRATED.md for details.")}`);
  } else {
    console.log(`  ${gray("Nothing migrated — ")}${result.reason}${gray(".")}`);
  }
  console.log();
}

function doValidate(cwd) {
  console.log();
  console.log(`  ${bold("🔥 infernoflow amp validate")}`);
  console.log();

  const { sessions, entries } = readRawEntries(cwd);
  if (!entries.length) {
    console.log(`  ${gray("No entries to validate at")} ${cyan(path.relative(cwd, sessions))}`);
    console.log();
    return;
  }

  let ok = 0, parseErrors = 0, schemaErrors = 0;
  const failures = [];
  for (const e of entries) {
    const fileLabel = path.relative(cwd, e.file);
    if (!e.ok) {
      parseErrors++;
      failures.push({ file: fileLabel, line: e.line, error: `parse error: ${e.error}` });
      continue;
    }
    const errs = validateAmpEntry(e.value, e.line);
    if (errs.length) {
      schemaErrors++;
      failures.push({ file: fileLabel, line: e.line, error: errs.join("; ") });
    } else {
      ok++;
    }
  }

  for (const f of failures.slice(0, 10)) {
    console.log(`  ${red("✘")} ${f.file}:${f.line}  ${gray(f.error)}`);
  }
  if (failures.length > 10) {
    console.log(`  ${gray(`… ${failures.length - 10} more`)}`);
  }
  if (failures.length) console.log();

  const total = entries.length;
  const allOk = parseErrors === 0 && schemaErrors === 0;
  if (allOk) {
    console.log(`  ${green("✔")} ${bold(`${ok}/${total}`)} entries conform to AMP v${AMP_VERSION}.`);
  } else {
    console.log(`  ${red("✘")} ${bold(`${ok}/${total}`)} entries OK · ${parseErrors} parse · ${schemaErrors} schema`);
  }
  console.log();
  if (!allOk) process.exit(1);
}

function doVersion() {
  console.log(AMP_VERSION);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function ampCommand(rawArgs) {
  const verb = rawArgs[1];
  const cwd  = process.cwd();

  if (!verb || verb === "status") return doStatus(cwd);
  if (verb === "migrate")          return doMigrate(cwd);
  if (verb === "validate")         return doValidate(cwd);
  if (verb === "version")          return doVersion();
  if (verb === "--help" || verb === "-h") return doStatus(cwd);

  console.error(red(`\n  Unknown amp verb: ${verb}`));
  console.error(gray(`  Try:  infernoflow amp  (status | migrate | validate | version)\n`));
  process.exit(1);
}

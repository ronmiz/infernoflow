/**
 * infernoflow sync
 *
 * Cross-machine sync for the personal memory layer (`global.jsonl`).
 *
 * Branch memory is already git-tracked (see lib/git/branch.mjs and the
 * branch-aware layout in lib/amp/io.mjs), so `git push/pull` carries it
 * between your machines automatically. This command exists for the OTHER
 * layer — personal preferences, things you don't want a teammate to see
 * but DO want available on every machine where you code.
 *
 * Recommended setup: point `globalDir` at a folder that's already synced
 * by your OS — iCloud / Dropbox / OneDrive / Google Drive / Syncthing.
 * Zero new infrastructure; the OS does the sync.
 *
 * Usage:
 *   infernoflow sync                       Show current setup
 *   infernoflow sync status                Same as bare invocation
 *   infernoflow sync set <path>            Configure synced directory
 *   infernoflow sync clear                 Remove configuration
 *   infernoflow sync migrate               Move existing local global.jsonl
 *                                          into the configured sync folder
 *   infernoflow sync --json                JSON output for any subcommand
 *
 * Resolution order (highest priority first):
 *   1. INFERNOFLOW_GLOBAL_DIR env var
 *   2. globalDir in <project>/.ai-memory/amp.json
 *   3. default: in-project at .ai-memory/global.jsonl (no cross-machine sync)
 */
import * as fs   from "node:fs";
import * as path from "node:path";

import { ampPaths, projectSlug } from "../amp/io.mjs";
import { findProjectRoot } from "../projectRoot.mjs";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

function readAmpJson(ampDir) {
  try { return JSON.parse(fs.readFileSync(path.join(ampDir, "amp.json"), "utf8")); }
  catch { return null; }
}

function writeAmpJson(ampDir, data) {
  fs.mkdirSync(ampDir, { recursive: true });
  fs.writeFileSync(path.join(ampDir, "amp.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
}

function countLines(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw.split("\n").filter(l => l.trim().length > 0).length;
  } catch { return 0; }
}

function describeSource(envVar, ampJsonValue) {
  if (envVar)        return { source: "env (INFERNOFLOW_GLOBAL_DIR)", value: envVar };
  if (ampJsonValue)  return { source: "amp.json (globalDir)",          value: ampJsonValue };
  return { source: "default (in-project)", value: null };
}

// ── status ────────────────────────────────────────────────────────────────

/** @param {{ jsonOut?: boolean }} [opts] */
function cmdStatus({ jsonOut } = {}) {
  const root = findProjectRoot(process.cwd());
  const p    = ampPaths(process.cwd());
  const cfg  = readAmpJson(p.root) || {};
  const src  = describeSource(process.env.INFERNOFLOW_GLOBAL_DIR, cfg.globalDir);
  const slug = projectSlug(root);
  const exists      = fs.existsSync(p.globalFile);
  const entries     = exists ? countLines(p.globalFile) : 0;
  // Detect orphan: sync configured but a non-empty local file still exists.
  const localFile   = path.join(p.root, "global.jsonl");
  const orphan      = src.value && localFile !== p.globalFile && fs.existsSync(localFile);
  const orphanLines = orphan ? countLines(localFile) : 0;

  if (jsonOut) {
    console.log(JSON.stringify({
      projectRoot: root,
      projectSlug: slug,
      configured:  Boolean(src.value),
      source:      src.source,
      configuredPath: src.value,
      resolvedFile:   p.globalFile,
      exists, entries,
      orphan, orphanLines,
    }, null, 2));
    return;
  }

  console.log("\n  " + bold("🔥 infernoflow sync — status"));
  console.log("  " + "─".repeat(58));
  console.log("  " + gray("Project           ") + cyan(slug));
  console.log("  " + gray("Source            ") + src.source);
  if (src.value) console.log("  " + gray("Configured path   ") + cyan(src.value));
  console.log("  " + gray("Resolved file     ") + cyan(p.globalFile));
  console.log("  " + gray("Status            ") + (exists ? green(`${entries} entries`) : gray("not yet created")));
  if (orphan) {
    console.log("");
    console.log("  " + yellow("⚠ Orphan local file detected"));
    console.log("  " + gray("  " + localFile + "  (" + orphanLines + " entries)"));
    console.log("  " + gray("  Run ") + cyan("infernoflow sync migrate") + gray(" to merge it into the synced location."));
  }
  console.log("");
  if (!src.value) {
    console.log("  " + gray("Tip: point at a synced folder (iCloud/Dropbox/etc.) to share personal"));
    console.log("  " + gray("     preferences across your own machines:"));
    console.log("  " + cyan("  infernoflow sync set ~/Dropbox/infernoflow-memory"));
    console.log("");
  }
}

// ── set / clear ───────────────────────────────────────────────────────────

/**
 * @param {string | undefined} target
 * @param {{ jsonOut?: boolean }} [opts]
 */
function cmdSet(target, { jsonOut } = {}) {
  if (!target) {
    console.error(red("\n  ✘ usage: infernoflow sync set <path>\n"));
    process.exit(1);
  }
  const p   = ampPaths(process.cwd(), { forWrite: true });
  const cfg = readAmpJson(p.root) || {};
  const previous = cfg.globalDir || null;
  cfg.globalDir = target;
  writeAmpJson(p.root, cfg);

  if (jsonOut) {
    console.log(JSON.stringify({ ok: true, previous, current: target, file: path.join(p.root, "amp.json") }, null, 2));
    return;
  }
  console.log("\n  " + green("✔ ") + "globalDir set to " + cyan(target));
  if (previous && previous !== target) {
    console.log("  " + gray("  (was: " + previous + ")"));
  }
  console.log("  " + gray("  Run ") + cyan("infernoflow sync migrate") + gray(" to move existing entries.\n"));
}

/** @param {{ jsonOut?: boolean }} [opts] */
function cmdClear({ jsonOut } = {}) {
  const p   = ampPaths(process.cwd(), { forWrite: true });
  const cfg = readAmpJson(p.root) || {};
  const previous = cfg.globalDir || null;
  if (!previous) {
    if (jsonOut) { console.log(JSON.stringify({ ok: true, changed: false }, null, 2)); return; }
    console.log("\n  " + gray("globalDir was not set — nothing to clear.\n"));
    return;
  }
  delete cfg.globalDir;
  writeAmpJson(p.root, cfg);
  if (jsonOut) {
    console.log(JSON.stringify({ ok: true, changed: true, previous }, null, 2));
    return;
  }
  console.log("\n  " + green("✔ ") + "globalDir cleared " + gray("(was " + previous + ")"));
  console.log("  " + gray("  global.jsonl is now in-project again. Old synced file is left in place.\n"));
}

// ── migrate ───────────────────────────────────────────────────────────────

/** @param {{ jsonOut?: boolean; dryRun?: boolean }} [opts] */
function cmdMigrate({ jsonOut, dryRun } = {}) {
  const p = ampPaths(process.cwd());
  const localFile = path.join(p.root, "global.jsonl");
  const targetFile = p.globalFile;

  if (localFile === targetFile) {
    if (jsonOut) { console.log(JSON.stringify({ ok: true, migrated: 0, reason: "sync not configured" }, null, 2)); return; }
    console.log("\n  " + gray("Sync not configured — nothing to migrate.\n"));
    return;
  }
  if (!fs.existsSync(localFile)) {
    if (jsonOut) { console.log(JSON.stringify({ ok: true, migrated: 0, reason: "no local global.jsonl" }, null, 2)); return; }
    console.log("\n  " + gray("No local global.jsonl to migrate.\n"));
    return;
  }

  const localLines  = fs.readFileSync(localFile, "utf8").split("\n").filter(Boolean);
  const targetExists = fs.existsSync(targetFile);
  const targetLines = targetExists
    ? fs.readFileSync(targetFile, "utf8").split("\n").filter(Boolean)
    : [];

  // Dedup by AMP id so re-running migrate is idempotent and merging machines
  // that both wrote to the synced location won't double-count.
  const seen = new Set();
  const merged = [];
  for (const line of [...targetLines, ...localLines]) {
    try {
      const obj = JSON.parse(line);
      const key = obj.id || line;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(line);
    } catch { /* skip malformed */ }
  }

  if (dryRun) {
    if (jsonOut) {
      console.log(JSON.stringify({
        ok: true, dryRun: true,
        wouldWrite: targetFile,
        fromLocal: localLines.length,
        existingTarget: targetLines.length,
        afterMerge: merged.length,
      }, null, 2));
      return;
    }
    console.log("\n  " + bold("🔥 infernoflow sync migrate") + gray(" — dry run"));
    console.log("  " + gray("From   ") + cyan(localFile)  + gray("  (" + localLines.length + " entries)"));
    console.log("  " + gray("To     ") + cyan(targetFile) + gray("  (" + targetLines.length + " existing)"));
    console.log("  " + gray("After  ") + green(merged.length + " entries (deduped by id)"));
    console.log("");
    return;
  }

  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, merged.join("\n") + (merged.length ? "\n" : ""), "utf8");
  // Archive the local copy rather than deleting — safer for the user.
  const archive = localFile.replace(/\.jsonl$/, `-archive-${Date.now()}.jsonl`);
  fs.renameSync(localFile, archive);

  if (jsonOut) {
    console.log(JSON.stringify({
      ok: true,
      migrated:    localLines.length,
      afterMerge:  merged.length,
      target:      targetFile,
      archivedAs:  archive,
    }, null, 2));
    return;
  }
  console.log("\n  " + green("✔ ") + "Migrated " + merged.length + " entries to " + cyan(targetFile));
  console.log("  " + gray("  Local file archived → " + path.basename(archive) + "\n"));
}

// ── entry point ───────────────────────────────────────────────────────────

export async function syncCommand(args) {
  const jsonOut = args.includes("--json");
  const dryRun  = args.includes("--dry-run") || args.includes("-n");
  // args[0] is "sync"; subverb is the first positional after it that isn't
  // a flag. `infernoflow sync --json` should resolve to verb=status, not
  // verb=--json.
  const verb = args.slice(1).find(a => !a.startsWith("-"));

  if (!verb || verb === "status" || verb === "--help" || verb === "-h") {
    if (verb === "--help" || verb === "-h") {
      console.log(`
  ${bold("🔥 infernoflow sync")} ${gray("— cross-machine personal memory")}

  ${bold("Usage:")}
    infernoflow sync                       Show current setup
    infernoflow sync status                Same as bare invocation
    infernoflow sync set <path>            Configure synced directory
    infernoflow sync clear                 Remove configuration
    infernoflow sync migrate [--dry-run]   Move local global.jsonl into sync

  ${bold("Recommended:")}
    point at an OS-synced folder (iCloud / Dropbox / OneDrive / Syncthing).
    Zero new infrastructure; the OS handles sync.

    ${cyan("infernoflow sync set ~/Dropbox/infernoflow-memory")}
`);
      return;
    }
    return cmdStatus({ jsonOut });
  }
  // For `set`, the target is the next non-flag positional after the verb.
  const positionals = args.slice(1).filter(a => !a.startsWith("-"));
  if (verb === "set")     return cmdSet(positionals[1], { jsonOut });
  if (verb === "clear")   return cmdClear({ jsonOut });
  if (verb === "migrate") return cmdMigrate({ jsonOut, dryRun });

  console.error(red(`\n  ✘ Unknown sync verb: ${verb}\n`));
  console.error(gray(`  Run: infernoflow sync --help\n`));
  process.exit(1);
}

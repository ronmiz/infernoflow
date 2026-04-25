/**
 * infernoflow changelog update
 *
 * Reads git commits since the last tag, groups them by type (feat/fix/chore/…),
 * drafts a clean ## Unreleased section, and writes it into CHANGELOG.md.
 *
 * Sub-commands:
 *   infernoflow changelog update      # draft Unreleased from commits
 *   infernoflow changelog show        # print current Unreleased block
 *   infernoflow changelog list        # list commits since last tag
 *
 * Flags (update):
 *   --ref <tag|commit>   Compare from a specific ref instead of last tag
 *   --dry-run            Print what would be written without touching the file
 *   --append             Append to existing ## Unreleased instead of replacing it
 *   --json               Machine-readable output
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { header, ok, fail, warn, info, done, bold, cyan, gray, green, yellow } from "../ui/output.mjs";

// ── git helpers ──────────────────────────────────────────────────────────────

function capture(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function lastTag(cwd) {
  return capture("git describe --tags --abbrev=0", cwd);
}

function commitsSince(ref, cwd) {
  // Returns array of { hash, subject, body }
  // Use NUL-delimited output to avoid shell escaping issues with separators
  const range = ref ? `${ref}..HEAD` : "";
  const raw = capture(`git log ${range} --format=%H%x1f%s%x1f%b%x1e`, cwd);
  if (!raw) return [];

  return raw
    .split("\x1e")
    .map(s => s.trim())
    .filter(Boolean)
    .map(block => {
      const parts = block.split("\x1f");
      return {
        hash:    (parts[0] || "").trim().slice(0, 8),
        subject: (parts[1] || "").trim(),
        body:    (parts[2] || "").trim(),
      };
    })
    .filter(c => c.subject);
}

function refDate(ref, cwd) {
  return capture(`git log -1 --format=%ci "${ref}"`, cwd)?.slice(0, 10) || null;
}

// ── commit classification ────────────────────────────────────────────────────

const TYPE_MAP = {
  feat:     "Added",
  feature:  "Added",
  add:      "Added",
  fix:      "Fixed",
  bugfix:   "Fixed",
  hotfix:   "Fixed",
  perf:     "Changed",
  refactor: "Changed",
  change:   "Changed",
  chore:    "Changed",
  docs:     "Changed",
  style:    "Changed",
  test:     "Changed",
  ci:       "Changed",
  remove:   "Removed",
  revert:   "Removed",
  deprecate:"Removed",
};

function classifyCommit(subject) {
  // Conventional commits: "feat: ..." or "feat(scope): ..."
  const match = subject.match(/^(\w+)(?:\([^)]+\))?[!]?:\s*(.+)/);
  if (match) {
    const type = match[1].toLowerCase();
    return {
      section: TYPE_MAP[type] || "Changed",
      message: match[2].trim(),
      breaking: subject.includes("!"),
    };
  }

  // Heuristic: starts with a keyword
  const lower = subject.toLowerCase();
  for (const [keyword, section] of Object.entries(TYPE_MAP)) {
    if (lower.startsWith(keyword + " ") || lower.startsWith(keyword + ":")) {
      return { section, message: subject, breaking: false };
    }
  }

  return { section: "Changed", message: subject, breaking: false };
}

function groupCommits(commits) {
  const sections = { Added: [], Fixed: [], Changed: [], Removed: [], Breaking: [] };

  for (const c of commits) {
    const { section, message, breaking } = classifyCommit(c.subject);
    if (breaking) sections.Breaking.push(message);
    sections[section].push(message);
  }

  // Remove duplicates (some commits end up in Breaking AND their category)
  for (const key of Object.keys(sections)) {
    sections[key] = [...new Set(sections[key])];
  }

  return sections;
}

// ── markdown rendering ───────────────────────────────────────────────────────

function renderUnreleased(sections, ref) {
  const lines = ["## Unreleased", ""];

  if (ref) {
    lines.push(`> Changes since ${ref}`, "");
  }

  const ORDER = ["Breaking", "Added", "Fixed", "Changed", "Removed"];
  let hasContent = false;

  for (const heading of ORDER) {
    const items = sections[heading];
    if (!items || !items.length) continue;
    hasContent = true;
    lines.push(`### ${heading}`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (!hasContent) {
    lines.push("- No significant changes", "");
  }

  return lines.join("\n");
}

// ── CHANGELOG file operations ────────────────────────────────────────────────

function readChangelog(changelogPath) {
  if (!fs.existsSync(changelogPath)) return null;
  return fs.readFileSync(changelogPath, "utf8");
}

function extractUnreleased(text) {
  // Returns the content of the ## Unreleased block, or null
  const match = text.match(/^## Unreleased[\s\S]*?(?=\n## |\n---|\z)/im);
  return match ? match[0].trim() : null;
}

function injectUnreleased(text, newBlock) {
  // Replace existing ## Unreleased block
  if (/^## Unreleased/im.test(text)) {
    return text.replace(
      /^## Unreleased[\s\S]*?(?=\n## |\n---)/im,
      newBlock + "\n\n"
    );
  }

  // No existing Unreleased block — insert after the first # heading
  if (/^# .+/im.test(text)) {
    return text.replace(
      /^(# .+\n)/im,
      `$1\n${newBlock}\n\n`
    );
  }

  // Prepend
  return `${newBlock}\n\n${text}`;
}

function appendToUnreleased(text, newBlock) {
  // Extract just the bullet lines from newBlock and append to existing Unreleased
  const newLines = newBlock.split("\n").filter(l => l.startsWith("- ")).join("\n");
  if (!newLines) return text;

  if (/^## Unreleased/im.test(text)) {
    // Find end of Unreleased and insert before next section
    return text.replace(
      /(^## Unreleased[\s\S]*?)(\n## )/im,
      `$1\n${newLines}\n$2`
    );
  }

  return injectUnreleased(text, newBlock);
}

// ── sub-commands ─────────────────────────────────────────────────────────────

function subcmdList(cwd, ref) {
  const tag = ref || lastTag(cwd);
  const commits = commitsSince(tag, cwd);

  if (!commits.length) {
    info(`No commits since ${tag || "beginning"}`);
    return;
  }

  console.log(`\n  ${bold("Commits since")} ${cyan(tag || "beginning")}  ${gray("(" + commits.length + ")")}\n`);
  for (const c of commits) {
    const { section } = classifyCommit(c.subject);
    const color = section === "Added" ? green : section === "Fixed" ? yellow : gray;
    console.log(`  ${gray(c.hash)}  ${color(c.subject)}`);
  }
  console.log();
}

function subcmdShow(changelogPath) {
  const text = readChangelog(changelogPath);
  if (!text) {
    fail("CHANGELOG.md not found");
    return;
  }
  const block = extractUnreleased(text);
  if (!block) {
    warn("No ## Unreleased section found in CHANGELOG.md");
    return;
  }
  console.log("\n" + block + "\n");
}

async function subcmdUpdate(cwd, changelogPath, opts) {
  const { ref, dryRun, append, asJson } = opts;

  const tag = ref || lastTag(cwd);
  const commits = commitsSince(tag, cwd);

  if (!commits.length) {
    if (asJson) {
      console.log(JSON.stringify({ ok: true, ref: tag, commits: 0, message: "No new commits" }));
      return;
    }
    warn(`No commits found since ${tag || "beginning of repo"}`);
    console.log();
    return;
  }

  const sections = groupCommits(commits);
  const newBlock  = renderUnreleased(sections, tag);

  if (asJson) {
    console.log(JSON.stringify({
      ok: true,
      ref: tag,
      commits: commits.length,
      sections: {
        breaking: sections.Breaking,
        added:    sections.Added,
        fixed:    sections.Fixed,
        changed:  sections.Changed,
        removed:  sections.Removed,
      },
      markdown: newBlock,
    }, null, 2));
    return;
  }

  // Print the drafted block
  console.log();
  console.log(gray("  ─── Drafted entry ─────────────────────────────────"));
  newBlock.split("\n").forEach(l => console.log("  " + l));
  console.log(gray("  ────────────────────────────────────────────────────"));
  console.log();
  info(`${commits.length} commit${commits.length > 1 ? "s" : ""} since ${cyan(tag || "beginning")}`);

  if (dryRun) {
    warn("Dry run — CHANGELOG.md not modified");
    console.log();
    return;
  }

  // Write to CHANGELOG.md
  let text = readChangelog(changelogPath);
  if (!text) {
    // Create a fresh changelog
    text = `# Changelog\n\n`;
  }

  const updated = append ? appendToUnreleased(text, newBlock) : injectUnreleased(text, newBlock);
  fs.writeFileSync(changelogPath, updated);

  ok(`CHANGELOG.md updated  ${gray("(" + (append ? "appended" : "replaced") + " ## Unreleased)")}`);
  console.log();
  done("Changelog drafted — review and edit before your next release");
  console.log(`  Run ${cyan("infernoflow publish")} when ready to cut the release\n`);
}

// ── AI changelog writer ───────────────────────────────────────────────────────

function parseCaps(jsonText) {
  if (!jsonText) return [];
  try {
    const obj = JSON.parse(jsonText);
    const raw = obj.capabilities || [];
    return raw.map(c => typeof c === "string" ? { id: c, title: c } : c);
  } catch { return []; }
}

function loadCapsFromDisk(infernoDir) {
  for (const name of ["capabilities.json", "contract.json"]) {
    const p = path.join(infernoDir, name);
    if (fs.existsSync(p)) return parseCaps(fs.readFileSync(p, "utf8"));
  }
  return [];
}

function loadCapsAtRef(ref, cwd) {
  try {
    for (const name of ["capabilities.json", "contract.json"]) {
      try {
        const content = execSync(`git show "${ref}:inferno/${name}"`, {
          cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
        }).trim();
        if (content) return parseCaps(content);
      } catch {}
    }
  } catch {}
  return [];
}

function diffCapsSimple(before, after) {
  const beforeMap = new Map(before.map(c => [c.id, c]));
  const afterMap  = new Map(after.map(c  => [c.id, c]));
  return {
    added:   after.filter(c  => !beforeMap.has(c.id)),
    removed: before.filter(c => !afterMap.has(c.id)),
    changed: after.filter(c  => {
      const old = beforeMap.get(c.id);
      return old && old.title !== c.title;
    }),
  };
}

function buildAiPrompt(commits, diff, ref, version) {
  const lines = [];
  lines.push(`You are writing a changelog entry for a software release.`);
  lines.push(`Write it in a friendly, clear, developer-facing tone.`);
  lines.push(`Use Markdown. Start with ## ${version || "Unreleased"}`);
  lines.push(`Include sections: ### Added, ### Fixed, ### Changed, ### Removed (only if non-empty).`);
  lines.push(`Be concise — one line per item. Do not include commit hashes.`);
  lines.push(`Do not invent features that are not listed below.`);
  lines.push(``);
  lines.push(`## Capability changes since ${ref || "last release"}:`);
  if (diff.added.length)   lines.push(`Added: ${diff.added.map(c => c.title || c.id).join(", ")}`);
  if (diff.removed.length) lines.push(`Removed: ${diff.removed.map(c => c.title || c.id).join(", ")}`);
  if (diff.changed.length) lines.push(`Changed: ${diff.changed.map(c => c.title || c.id).join(", ")}`);
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) lines.push(`(no capability changes)`);
  lines.push(``);
  lines.push(`## Git commits since ${ref || "last release"}:`);
  for (const c of commits.slice(0, 40)) lines.push(`- ${c.subject}`);
  lines.push(``);
  lines.push(`Write the changelog entry now:`);
  return lines.join("\n");
}

function buildStructuredFallback(commits, diff, version) {
  // High-quality template fallback when no AI provider is available
  const sections = groupCommits(commits);

  // Merge capability changes into sections
  for (const c of diff.added)   sections.Added.unshift(`${c.title || c.id} capability`);
  for (const c of diff.removed) sections.Removed.unshift(`${c.title || c.id} capability`);
  for (const c of diff.changed) sections.Changed.unshift(`Updated ${c.title || c.id} capability`);

  // Deduplicate
  for (const key of Object.keys(sections)) sections[key] = [...new Set(sections[key])];

  const tag = version || "Unreleased";
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`## ${tag} — ${date}`, ""];

  const ORDER = ["Breaking", "Added", "Fixed", "Changed", "Removed"];
  for (const heading of ORDER) {
    const items = sections[heading];
    if (!items?.length) continue;
    lines.push(`### ${heading}`);
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  }

  return lines.join("\n");
}

async function callLocalAi(prompt) {
  // Try Ollama (localhost:11434) — most common local AI setup
  try {
    const { default: http } = await import("node:http");
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ model: "llama3", prompt, stream: false });
      const req = http.request({
        hostname: "localhost", port: 11434,
        path: "/api/generate", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      }, (res) => {
        let raw = "";
        res.on("data", d => raw += d);
        res.on("end", () => {
          try { resolve(JSON.parse(raw).response || null); } catch { resolve(null); }
        });
      });
      req.setTimeout(30_000, () => { req.destroy(); reject(new Error("timeout")); });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  } catch { return null; }
}

async function callAnthropicAi(prompt, apiKey) {
  const { default: https } = await import("node:https");
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages", method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = "";
      res.on("data", d => raw += d);
      res.on("end", () => {
        try {
          const data = JSON.parse(raw);
          resolve(data.content?.[0]?.text || null);
        } catch { resolve(null); }
      });
    });
    req.setTimeout(30_000, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function subcmdAi(cwd, changelogPath, opts) {
  const { ref, dryRun, asJson, version } = opts;
  const infernoDir = path.join(cwd, "inferno");

  const tag     = ref || lastTag(cwd);
  const commits = commitsSince(tag, cwd);

  // Load capability diff
  const currentCaps = fs.existsSync(infernoDir) ? loadCapsFromDisk(infernoDir) : [];
  const prevCaps    = tag ? (() => {
    try {
      const ex = require("child_process").execSync;
      for (const name of ["capabilities.json", "contract.json"]) {
        try {
          const c = ex(`git show "${tag}:inferno/${name}"`, { cwd, encoding: "utf8", stdio: ["ignore","pipe","pipe"] }).trim();
          if (c) return parseCaps(c);
        } catch {}
      }
      return [];
    } catch { return []; }
  })() : [];

  const diff = diffCapsSimple(prevCaps, currentCaps);

  if (!asJson) {
    info(`Generating AI changelog since ${bold(tag || "beginning")}...`);
    info(`${commits.length} commits · ${diff.added.length} added · ${diff.removed.length} removed · ${diff.changed.length} changed`);
    console.log();
  }

  const prompt = buildAiPrompt(commits, diff, tag, version);
  let aiText = null;
  let provider = "template";

  // Try AI providers in order: Anthropic API → Ollama → structured template
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    try {
      aiText = await callAnthropicAi(prompt, anthropicKey);
      if (aiText) provider = "anthropic";
    } catch {}
  }

  if (!aiText) {
    try {
      aiText = await callLocalAi(prompt);
      if (aiText) provider = "ollama";
    } catch {}
  }

  // Fallback: structured template
  if (!aiText) {
    aiText = buildStructuredFallback(commits, diff, version);
    provider = "template";
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: true, provider, ref: tag, commits: commits.length, markdown: aiText }));
    return;
  }

  console.log(gray("  ─── Generated changelog ──────────────────────────────"));
  aiText.split("\n").forEach(l => console.log("  " + l));
  console.log(gray("  ──────────────────────────────────────────────────────"));
  console.log();
  if (provider === "template") {
    console.log(`  ${yellow("💡")} ${gray("For AI-written changelogs:")}  ${cyan("infernoflow ai setup")}`);
  } else {
    info(`Generated via: ${bold(provider)}`);
  };

  if (dryRun) {
    warn("Dry run — CHANGELOG.md not modified");
    console.log();
    return;
  }

  // Write to CHANGELOG.md
  let text = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "# Changelog\n\n";
  const updated = injectUnreleased(text, aiText);
  fs.writeFileSync(changelogPath, updated);

  ok(`CHANGELOG.md updated with AI-generated entry`);
  if (provider === "template") {
    info(`Tip: set ANTHROPIC_API_KEY for richer AI-written changelogs`);
  }
  console.log();
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function changelogCommand(rawArgs) {
  const args = rawArgs.slice(1); // drop "changelog"

  // Sub-command: first non-flag arg
  const sub = args.find(a => !a.startsWith("-")) || "update";

  const dryRun  = args.includes("--dry-run");
  const append  = args.includes("--append");
  const asJson  = args.includes("--json");

  const refIdx     = args.indexOf("--ref");
  const versionIdx = args.indexOf("--version");
  const ref     = refIdx     !== -1 ? args[refIdx + 1]     : null;
  const version = versionIdx !== -1 ? args[versionIdx + 1] : null;

  const cwd           = process.cwd();
  const changelogPath = path.join(cwd, "CHANGELOG.md");

  if (!asJson) header("changelog " + sub);

  if (sub === "list") {
    subcmdList(cwd, ref);
    return;
  }

  if (sub === "show") {
    subcmdShow(changelogPath);
    return;
  }

  if (sub === "update") {
    await subcmdUpdate(cwd, changelogPath, { ref, dryRun, append, asJson });
    return;
  }

  if (sub === "ai") {
    await subcmdAi(cwd, changelogPath, { ref, dryRun, asJson, version });
    return;
  }

  fail(`Unknown sub-command: ${sub}`, "Use: update | show | list | ai");
  process.exit(1);
}

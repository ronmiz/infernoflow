#!/usr/bin/env node
/**
 * infernoflow GitHub Action — PR comment v2
 *
 * Reads inferno/sessions.jsonl + contract.json and posts a single PR comment
 * (idempotently re-edited on subsequent runs) showing:
 *   - Gotchas relevant to changed files, with the matched file shown inline
 *     when the relevance was a direct filename hit
 *   - Failed attempts whose summary touches the same surface — "don't repeat"
 *   - Decisions in effect for the touched areas
 *   - Frozen capabilities affected by the diff, with an `infernoflow impact` tip
 *   - Health footer with the total session-memory size
 *
 * Environment variables (set by GitHub Actions):
 *   GITHUB_TOKEN          — for posting comments
 *   GITHUB_REPOSITORY     — owner/repo
 *   GITHUB_EVENT_PATH     — path to event.json
 *   INPUT_SESSIONS-FILE   — path to sessions.jsonl
 *   INPUT_MIN-TYPE        — gotcha | decision | both | always
 *   INPUT_FAIL-ON-FROZEN  — true | false
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function readJSONL(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8")
    .split("\n").filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function httpsRequest(method, url, data, headers) {
  return new Promise((resolve, reject) => {
    const body   = data ? JSON.stringify(data) : null;
    const parsed = new URL(url);
    const opts   = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method,
      headers:  {
        "User-Agent": "infernoflow-action/2.0",
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        ...headers,
      },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
const httpsGet   = (url, headers)       => httpsRequest("GET",   url, null, headers);
const httpsPost  = (url, data, headers) => httpsRequest("POST",  url, data, headers);
const httpsPatch = (url, data, headers) => httpsRequest("PATCH", url, data, headers);

// ── PR diff ───────────────────────────────────────────────────────────────────

async function getChangedFiles(owner, repo, prNumber, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`;
  const res = await httpsGet(url, { Authorization: `token ${token}` });
  if (res.status !== 200) {
    console.error(`Failed to get PR files: ${res.status} ${res.body}`);
    return [];
  }
  return JSON.parse(res.body).map(f => f.filename);
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

const FILE_KEYWORDS = [
  { patterns: ["auth", "login", "logout", "jwt", "token", "session", "password"],   files: ["auth", "login", "session", "jwt"] },
  { patterns: ["upload", "file", "s3", "storage", "bucket", "multipart"],            files: ["upload", "file", "storage", "media"] },
  { patterns: ["api", "endpoint", "route", "handler", "request", "response"],        files: ["api", "route", "handler", "controller", "endpoint"] },
  { patterns: ["database", "db", "prisma", "mongoose", "postgres", "sql", "migration"], files: ["db", "database", "prisma", "migration", "model", "schema"] },
  { patterns: ["stripe", "payment", "billing", "checkout", "subscription"],          files: ["payment", "stripe", "billing", "checkout"] },
  { patterns: ["email", "smtp", "sendgrid", "ses", "notification"],                  files: ["email", "mail", "notification", "smtp"] },
  { patterns: ["cache", "redis", "memcache"],                                        files: ["cache", "redis"] },
  { patterns: ["test", "spec", "mock", "fixture"],                                   files: ["test", "spec", "mock", "__tests__"] },
  { patterns: ["config", "env", "environment", "secret"],                            files: [".env", "config", "settings"] },
  { patterns: ["deploy", "docker", "ci", "workflow", "action", "kubernetes"],        files: ["dockerfile", "docker", ".yml", "workflow", "deploy"] },
];

/**
 * Returns { score, matchedFile } where matchedFile is the changed-file path
 * that most directly triggered the relevance, or null for semantic-only hits.
 *   3 = direct: gotcha summary mentions a changed file's basename
 *   2 = semantic: gotcha topic + file topic both match a keyword cluster
 *   0 = irrelevant
 */
function scoreRelevance(entry, changedFiles) {
  const text = (entry.summary || "").toLowerCase();

  for (const f of changedFiles) {
    const fname = path.basename(f).toLowerCase().replace(/\.[^.]+$/, "");
    if (fname.length > 2 && text.includes(fname)) {
      return { score: 3, matchedFile: f };
    }
  }

  for (const rule of FILE_KEYWORDS) {
    if (!rule.patterns.some(kw => text.includes(kw))) continue;
    const hit = changedFiles.find(f =>
      rule.files.some(kw => f.toLowerCase().includes(kw))
    );
    if (hit) return { score: 2, matchedFile: hit };
  }

  return { score: 0, matchedFile: null };
}

function annotate(entries, changedFiles) {
  return entries
    .map(e => ({ ...e, ...scoreRelevance(e, changedFiles) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);
}

// ── Frozen capability matching ────────────────────────────────────────────────

function frozenTouches(contract, changedFiles) {
  const caps = contract?.capabilities || [];
  const frozen = caps.filter(c => c.status === "frozen" || c.frozen || c === c.toString().toUpperCase());
  // contract may store capabilities as either string IDs or {id, status} objects
  const normalized = frozen.map(c => (typeof c === "string" ? { id: c } : c)).filter(c => c.id);
  return normalized.filter(cap =>
    changedFiles.some(f => f.toLowerCase().includes(cap.id.toLowerCase()))
  );
}

// ── Comment construction ─────────────────────────────────────────────────────

const COMMENT_MARKER = "<!-- infernoflow-action:pr-memory-check -->";

function buildComment(entries, changedFiles, contract, opts) {
  const { minType } = opts;

  const gotchas   = annotate(entries.filter(e => e.type === "gotcha"),  changedFiles);
  const decisions = annotate(entries.filter(e => e.type === "decision"), changedFiles);
  const attempts  = annotate(
    entries.filter(e => e.type === "attempt" && (e.result === "failed" || e.result === "partial")),
    changedFiles,
  );

  const touchedFrozen = frozenTouches(contract, changedFiles);
  const total = entries.length;
  const totalGotchas = entries.filter(e => e.type === "gotcha").length;
  const totalDecisions = entries.filter(e => e.type === "decision").length;

  const hasAnything =
    gotchas.length > 0 ||
    (minType !== "gotcha" && decisions.length > 0) ||
    attempts.length > 0 ||
    touchedFrozen.length > 0;

  if (!hasAnything && minType !== "always") return null;

  const lines = [
    COMMENT_MARKER,
    `## 🔥 infernoflow — PR Memory Check`,
    ``,
    `> **${changedFiles.length} files changed** · ${total} session ${total === 1 ? "entry" : "entries"} loaded · ${totalGotchas} gotchas · ${totalDecisions} decisions`,
    ``,
  ];

  if (gotchas.length > 0) {
    lines.push(`### ⚠️ Gotchas to watch out for`, ``);
    for (const e of gotchas.slice(0, 6)) {
      const date = e.ts ? new Date(e.ts).toISOString().slice(0, 10) : "";
      const file = e.matchedFile && e.score === 3 ? ` _(touched: \`${e.matchedFile}\`)_` : "";
      lines.push(`- **${e.summary}**${file}${date ? ` _(${date})_` : ""}`);
    }
    lines.push(``);
  }

  if (attempts.length > 0) {
    lines.push(`### ❌ Already tried — don't repeat`, ``);
    for (const e of attempts.slice(0, 4)) {
      const file = e.matchedFile && e.score === 3 ? ` _(touched: \`${e.matchedFile}\`)_` : "";
      lines.push(`- ${e.summary}${file}`);
    }
    lines.push(``);
  }

  if (decisions.length > 0 && minType !== "gotcha") {
    lines.push(`### ✅ Decisions in effect`, ``);
    for (const e of decisions.slice(0, 5)) {
      lines.push(`- ${e.summary}`);
    }
    lines.push(``);
  }

  if (touchedFrozen.length > 0) {
    lines.push(`### 🧊 Protected capabilities affected`, ``);
    for (const cap of touchedFrozen) {
      lines.push(`- \`${cap.id}\` is frozen — verify behaviour didn't drift`);
    }
    lines.push(``);
    lines.push(`> Run \`infernoflow impact ${touchedFrozen[0].id}\` locally for full blast-radius analysis.`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`<sub>🔥 [infernoflow](https://infernoflow.dev) — persistent memory for AI coding sessions · log a gotcha: \`infernoflow log "..." --type gotcha\`</sub>`);

  return lines.join("\n");
}

// ── Comment upsert ────────────────────────────────────────────────────────────

async function findExistingComment(owner, repo, prNumber, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`;
  const res = await httpsGet(url, { Authorization: `token ${token}` });
  if (res.status !== 200) return null;
  const comments = JSON.parse(res.body);
  // Prefer the explicit marker; fall back to the title for comments written by v1
  return comments.find(c =>
    c.body?.includes(COMMENT_MARKER) || c.body?.includes("infernoflow — PR Memory Check")
  ) || null;
}

async function upsertComment(owner, repo, prNumber, token, body) {
  const existing = await findExistingComment(owner, repo, prNumber, token);
  const auth     = { Authorization: `token ${token}` };

  if (existing) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`;
    const res = await httpsPatch(url, { body }, auth);
    return { action: "updated", id: existing.id, status: res.status };
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const res = await httpsPost(url, { body }, auth);
  return { action: "created", status: res.status };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const token      = process.env["INPUT_GITHUB-TOKEN"] || process.env.INPUT_GITHUBTOKEN || process.env.GITHUB_TOKEN;
  const sessFile   = process.env["INPUT_SESSIONS-FILE"] || "inferno/sessions.jsonl";
  const minType    = process.env["INPUT_MIN-TYPE"] || "both";
  const failFrozen = process.env["INPUT_FAIL-ON-FROZEN"] === "true";
  const eventPath  = process.env.GITHUB_EVENT_PATH;
  const repository = process.env.GITHUB_REPOSITORY || "";

  if (!token) {
    console.error("❌ GITHUB_TOKEN not set");
    process.exit(1);
  }

  const event    = eventPath && fs.existsSync(eventPath) ? readJSON(eventPath) : null;
  const prNumber = event?.pull_request?.number || event?.number;
  if (!prNumber) {
    console.log("ℹ Not a PR event — skipping");
    process.exit(0);
  }

  const [owner, repo] = repository.split("/");
  console.log(`🔥 infernoflow action v2 — PR #${prNumber} in ${repository}`);

  const entries = readJSONL(sessFile);
  if (!entries.length) {
    console.log(`ℹ No session entries at ${sessFile} — nothing to report`);
    process.exit(0);
  }
  console.log(`  Loaded ${entries.length} entries from ${sessFile}`);

  const changedFiles = await getChangedFiles(owner, repo, prNumber, token);
  console.log(`  PR touches ${changedFiles.length} files`);

  const contract = readJSON("inferno/contract.json");
  const comment  = buildComment(entries, changedFiles, contract, { minType });

  if (!comment) {
    console.log("  ✔ No relevant gotchas, decisions, or frozen-cap touches — skipping comment");
    process.exit(0);
  }

  const result = await upsertComment(owner, repo, prNumber, token, comment);
  console.log(`  ✔ Comment ${result.action} (status: ${result.status}${result.id ? `, id: ${result.id}` : ""})`);

  if (failFrozen) {
    const touched = frozenTouches(contract, changedFiles);
    if (touched.length > 0) {
      console.error(`❌ ${touched.length} frozen capability/capabilities touched — failing as requested`);
      process.exit(1);
    }
  }

  console.log("  🔥 Done");
}

main().catch(err => {
  console.error("❌ Action failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * infernoflow GitHub Action — PR comment v2
 *
 * Reads the memory store (.ai-memory/, or legacy inferno/sessions.jsonl) +
 * contract.json and posts a single PR comment (idempotently re-edited on
 * subsequent runs) showing:
 *   - Memory entries ADDED by this PR, for review like code (they reach every
 *     teammate's AI after merge)
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
 *   INPUT_SESSIONS-FILE   — optional single JSONL file (default: .ai-memory/)
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

/** PR files as { filename, status, patch? }. GitHub lists at most 3,000 files. */
const MAX_FILE_PAGES = 30;
async function getPrFiles(owner, repo, prNumber, token) {
  /** @type {any[] & { truncated?: boolean }} */
  const all = [];
  all.truncated = false;
  for (let page = 1; page <= MAX_FILE_PAGES; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`;
    const res = await httpsGet(url, { Authorization: `token ${token}` });
    if (res.status !== 200) {
      console.error(`Failed to get PR files: ${res.status} ${res.body}`);
      break;
    }
    const batch = JSON.parse(res.body);
    all.push(...batch);
    if (batch.length < 100) break;
    if (page === MAX_FILE_PAGES) all.truncated = true;
  }
  return all;
}

// ── Memory store (.ai-memory/, AMP) ──────────────────────────────────────────

const MEMORY_DIR = ".ai-memory";

/** Shared memory files in the checkout: global.jsonl + branches/*.jsonl (+ legacy sessions.jsonl if committed). */
function memoryFiles(root = MEMORY_DIR) {
  const out = [];
  for (const f of ["sessions.jsonl", "global.jsonl"]) {
    if (fs.existsSync(path.join(root, f))) out.push(path.join(root, f));
  }
  const br = path.join(root, "branches");
  try { for (const f of fs.readdirSync(br)) if (f.endsWith(".jsonl")) out.push(path.join(br, f)); } catch {}
  return out;
}

/** AMP entry ({type,msg,ts,meta}) → the {type,summary,ts,result} shape used below. */
function normalize(e) {
  if (!e || typeof e !== "object") return null;
  const meta = e.meta || {};
  return {
    ...e,
    type: meta.subtype || e.type || "note",
    summary: e.summary || e.msg || "",
    result: e.result || meta.result,
    author: meta.author || null,
  };
}

function loadMemory(sessFileInput, root = ".") {
  if (sessFileInput) return readJSONL(path.resolve(root, sessFileInput)).map(normalize).filter(Boolean);
  const files = memoryFiles(path.join(root, MEMORY_DIR));
  if (files.length) {
    const seen = new Set(), out = [];
    for (const f of files) for (const e of readJSONL(f).map(normalize).filter(Boolean)) {
      const k = e.id || `${e.ts}|${e.summary}`;
      if (!seen.has(k)) { seen.add(k); out.push(e); }
    }
    return out;
  }
  return readJSONL(path.join(root, "inferno", "sessions.jsonl")).map(normalize).filter(Boolean);   // pre-0.44 layout
}

// Any store in the repo (monorepos keep one per package), legacy inferno/ too.
const MEMORY_PATH_RE = /(^|\/)(\.ai-memory|inferno)\//;
const DETAIL_FILE_RE = /(^|\/)\.ai-memory\/details(\.local)?\.jsonl$/;
const isMemoryEntryFile = (f) => {
  const n = f.replace(/\\/g, "/");
  return MEMORY_PATH_RE.test(n) && n.endsWith(".jsonl") && !DETAIL_FILE_RE.test(n);
};

/**
 * Memory entries this PR adds — read from the diff. Memory is shown to every
 * teammate's AI, so a reviewer should see it like code (F6).
 * @param {any[] & { truncated?: boolean }} prFiles
 * @returns {{ entries: any[], files: string[], unreadable: string[], detailFiles: string[], removedFiles: string[], removedLines: number, truncated: boolean }}
 */
function memoryAddedInPr(prFiles) {
  const entries = [], files = [], unreadable = [], detailFiles = [], removedFiles = [];
  let removedLines = 0;
  for (const f of prFiles) {
    const n = String(f.filename || "").replace(/\\/g, "/");
    if (DETAIL_FILE_RE.test(n)) { detailFiles.push(n); continue; }
    if (!isMemoryEntryFile(n)) continue;
    if (f.status === "removed") { removedFiles.push(n); continue; }
    files.push(n);
    if (typeof f.patch !== "string") { unreadable.push(n); continue; }   // GitHub omits very large patches
    for (const line of f.patch.split("\n")) {
      if (line.startsWith("-") && !line.startsWith("---")) { if (line.slice(1).trim()) removedLines++; continue; }
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      let e; try { e = JSON.parse(line.slice(1)); } catch { continue; }
      const ne = normalize(e);
      if (ne && ne.summary) entries.push({ ...ne, sourceFile: n });
    }
  }
  return { entries, files, unreadable, detailFiles, removedFiles, removedLines, truncated: !!prFiles.truncated };
}

/**
 * Untrusted text (memory written by anyone who can open a PR) as inert,
 * single-line markdown: no links, images, emphasis, HTML, entities, tables,
 * mentions or code spans survive.
 */
function safeLine(t, max = 200) {
  const one = String(t == null ? "" : t).replace(/\s+/g, " ").trim();
  const cut = one.length > max ? one.slice(0, max) + "…" : one;
  return cut
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+!|~:$]/g, c => "\\" + c)
    .replace(/@/g, "@\u200b")
    .replace(/(https?|ftp|mailto|javascript|data)(?=\\:)/gi, m => m.split("").join("\u200b"))
    .replace(/www\./gi, m => m.slice(0, 3) + "\u200b.");
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
  const { minType, memoryDiff = { entries: [], files: [], unreadable: [], detailFiles: [], removedFiles: [], removedLines: 0, truncated: false } } = opts;

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

  const memoryChanged = memoryDiff.files.length > 0 || memoryDiff.detailFiles.length > 0 || (memoryDiff.removedFiles || []).length > 0;
  const hasAnything =
    memoryChanged || !!memoryDiff.truncated ||
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

  if (memoryChanged) {
    const n = memoryDiff.entries.length;
    lines.push(`### 🧠 Memory changed in this PR — review it like code`, ``);
    lines.push(`> After merge these entries are shown to every teammate's AI assistant. Check that they are accurate and contain no instructions, commands or secrets. The author is what each entry claims — see the commit history for who actually wrote it.`, ``);
    for (const e of memoryDiff.entries.slice(0, 20)) {
      const by = e.author ? ` — claims author: ${safeLine(e.author, 60)}` : "";
      const file = e.file ? ` (${safeLine(e.file, 120)})` : "";
      lines.push(`- **${safeLine(e.type, 20)}**${file}: ${safeLine(e.summary)}${by}`);
    }
    if (n > 20) lines.push(`- …and ${n - 20} more`);
    if (!n && memoryDiff.files.length && !memoryDiff.unreadable.length && !memoryDiff.removedLines) lines.push(`- _(memory files changed, but no entries were added)_`);
    if (memoryDiff.removedLines) lines.push(`- ✂️ ${memoryDiff.removedLines} existing entr${memoryDiff.removedLines === 1 ? "y was" : "ies were"} removed or edited (lines starting with \`-\` in the diff)`);
    for (const f of memoryDiff.removedFiles || []) lines.push(`- 🗑️ memory file deleted: ${safeLine(f, 160)}`);
    for (const f of memoryDiff.unreadable) lines.push(`- ⚠️ ${safeLine(f, 160)} changed but the diff is too large to show here — review it in the Files tab`);
    if (memoryDiff.detailFiles.length) lines.push(`- 📎 Long-form entry details changed: ${memoryDiff.detailFiles.map(f => safeLine(f, 160)).join(", ")}`);
    lines.push(``);
  }
  if (memoryDiff.truncated) {
    lines.push(`> ⚠️ This PR changes more files than GitHub lists (3,000). Memory changes beyond that were not checked — review \`.ai-memory/\` in the Files tab.`, ``);
  }

  if (gotchas.length > 0) {
    lines.push(`### ⚠️ Gotchas to watch out for`, ``);
    for (const e of gotchas.slice(0, 6)) {
      const date = e.ts ? new Date(e.ts).toISOString().slice(0, 10) : "";
      const file = e.matchedFile && e.score === 3 ? ` _(touched: ${safeLine(e.matchedFile, 160)})_` : "";
      lines.push(`- **${safeLine(e.summary)}**${file}${date ? ` _(${date})_` : ""}`);
    }
    lines.push(``);
  }

  if (attempts.length > 0) {
    lines.push(`### ❌ Already tried — don't repeat`, ``);
    for (const e of attempts.slice(0, 4)) {
      const file = e.matchedFile && e.score === 3 ? ` _(touched: ${safeLine(e.matchedFile, 160)})_` : "";
      lines.push(`- ${safeLine(e.summary)}${file}`);
    }
    lines.push(``);
  }

  if (decisions.length > 0 && minType !== "gotcha") {
    lines.push(`### ✅ Decisions in effect`, ``);
    for (const e of decisions.slice(0, 5)) {
      lines.push(`- ${safeLine(e.summary)}`);
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

// The workflow token's identity. With a personal token the action simply
// posts a new comment each run instead of editing someone else's.
const BOT_LOGIN = "github-actions[bot]";

async function findExistingComment(owner, repo, prNumber, token) {
  // Only a comment the workflow's own bot posted. Anyone can post a comment
  // containing the marker; editing theirs would put our review under their name.
  for (let page = 1; page <= 10; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`;
    const res = await httpsGet(url, { Authorization: `token ${token}` });
    if (res.status !== 200) return null;
    const comments = JSON.parse(res.body);
    const mine = comments.find(c => c.user && c.user.login === BOT_LOGIN && typeof c.body === "string" && c.body.includes(COMMENT_MARKER));
    if (mine) return mine;
    if (comments.length < 100) return null;
  }
  return null;
}

async function upsertComment(owner, repo, prNumber, token, body) {
  const existing = await findExistingComment(owner, repo, prNumber, token);
  const auth     = { Authorization: `token ${token}` };

  if (existing) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`;
    const res = await httpsPatch(url, { body }, auth);
    return { action: "updated", id: existing.id, status: res.status, ok: res.status >= 200 && res.status < 300 };
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const res = await httpsPost(url, { body }, auth);
  return { action: "created", status: res.status, ok: res.status >= 200 && res.status < 300 };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const token      = process.env["INPUT_GITHUB-TOKEN"] || process.env.INPUT_GITHUBTOKEN || process.env.GITHUB_TOKEN;
  const sessFile   = process.env["INPUT_SESSIONS-FILE"] || "";   // default: .ai-memory/ (then legacy inferno/)
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

  const entries = loadMemory(sessFile);
  console.log(`  Loaded ${entries.length} memory entries${sessFile ? ` from ${sessFile}` : ""}`);

  const prFiles      = await getPrFiles(owner, repo, prNumber, token);
  const changedFiles = prFiles.map(f => f.filename);
  console.log(`  PR touches ${changedFiles.length} files`);
  const memoryDiff = memoryAddedInPr(prFiles);
  if (memoryDiff.files.length) console.log(`  PR adds ${memoryDiff.entries.length} memory entries in ${memoryDiff.files.length} file(s)`);

  if (!entries.length && !memoryDiff.files.length && !memoryDiff.detailFiles.length) {
    console.log("ℹ No memory entries and no memory changes — nothing to report");
    process.exit(0);
  }

  const contract = readJSON("inferno/contract.json");
  const comment  = buildComment(entries, changedFiles, contract, { minType, memoryDiff });

  if (!comment) {
    console.log("  ✔ No relevant gotchas, decisions, or frozen-cap touches — skipping comment");
    process.exit(0);
  }

  const result = await upsertComment(owner, repo, prNumber, token, comment);
  if (!result.ok) {
    // Typical cause: a pull request from a fork gets a read-only token.
    console.error(`❌ Could not post the PR comment (HTTP ${result.status}). For pull requests from forks the token is read-only — see the action README.`);
    if (process.env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, comment + "\n"); } catch {} }
    process.exit(memoryDiff.files.length || memoryDiff.detailFiles.length || memoryDiff.removedFiles.length ? 1 : 0);
  }
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

if (require.main === module) main().catch(err => {
  console.error("❌ Action failed:", err.message);
  console.error(err.stack);
  process.exit(1);
});

module.exports = { memoryAddedInPr, buildComment, loadMemory, safeLine, normalize };

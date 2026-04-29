#!/usr/bin/env node
/**
 * infernoflow GitHub Action
 *
 * Reads inferno/sessions.jsonl and posts a PR comment showing:
 *   - Gotchas relevant to changed files
 *   - Decisions in effect
 *   - Frozen capabilities at risk
 *
 * Environment variables (set by GitHub Actions):
 *   GITHUB_TOKEN          — for posting comments
 *   GITHUB_REPOSITORY     — owner/repo
 *   GITHUB_EVENT_PATH     — path to event.json
 *   INPUT_SESSIONS_FILE   — path to sessions.jsonl
 *   INPUT_MIN_TYPE        — gotcha | decision | both
 *   INPUT_FAIL_ON_FROZEN  — true | false
 */

const fs   = require("fs");
const path = require("path");
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

function httpsPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const body   = JSON.stringify(data);
    const parsed = new URL(url);
    const opts   = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent":     "infernoflow-action/1.0",
        ...headers,
      },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts   = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   "GET",
      headers:  { "User-Agent": "infernoflow-action/1.0", ...headers },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Get changed files from PR ─────────────────────────────────────────────────

async function getChangedFiles(owner, repo, prNumber, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`;
  const res = await httpsGet(url, { Authorization: `token ${token}` });
  if (res.status !== 200) {
    console.error(`Failed to get PR files: ${res.status} ${res.body}`);
    return [];
  }
  const files = JSON.parse(res.body);
  return files.map(f => f.filename);
}

// ── Match entries to changed files ───────────────────────────────────────────

function scoreRelevance(entry, changedFiles) {
  const text = (entry.summary || "").toLowerCase();

  // Keyword → file pattern matching
  const FILE_KEYWORDS = [
    { patterns: ["auth", "login", "logout", "jwt", "token", "session", "password"], files: ["auth", "login", "session", "jwt"] },
    { patterns: ["upload", "file", "s3", "storage", "bucket", "multipart"],         files: ["upload", "file", "storage", "media"] },
    { patterns: ["api", "endpoint", "route", "handler", "request", "response"],     files: ["api", "route", "handler", "controller", "endpoint"] },
    { patterns: ["database", "db", "prisma", "mongoose", "postgres", "sql", "migration"], files: ["db", "database", "prisma", "migration", "model", "schema"] },
    { patterns: ["stripe", "payment", "billing", "checkout", "subscription"],       files: ["payment", "stripe", "billing", "checkout"] },
    { patterns: ["email", "smtp", "sendgrid", "ses", "notification"],               files: ["email", "mail", "notification", "smtp"] },
    { patterns: ["cache", "redis", "memcache"],                                     files: ["cache", "redis"] },
    { patterns: ["test", "spec", "mock", "fixture"],                                files: ["test", "spec", "mock", "__tests__"] },
    { patterns: ["config", "env", "environment", "secret"],                         files: [".env", "config", "settings"] },
    { patterns: ["deploy", "docker", "ci", "workflow", "action", "kubernetes"],     files: ["dockerfile", "docker", ".yml", "workflow", "deploy"] },
  ];

  // Direct: gotcha text mentions a changed file name
  for (const f of changedFiles) {
    const fname = path.basename(f).toLowerCase().replace(/\.[^.]+$/, "");
    if (fname.length > 2 && text.includes(fname)) return 3; // high relevance
  }

  // Semantic: gotcha topic matches changed file topic
  for (const rule of FILE_KEYWORDS) {
    const entryMatches = rule.patterns.some(kw => text.includes(kw));
    if (!entryMatches) continue;
    const fileMatches = changedFiles.some(f =>
      rule.files.some(kw => f.toLowerCase().includes(kw))
    );
    if (fileMatches) return 2; // medium relevance
  }

  return 0; // not relevant
}

// ── Build PR comment ──────────────────────────────────────────────────────────

function buildComment(entries, changedFiles, prNumber, minType) {
  const gotchas   = entries.filter(e => e.type === "gotcha");
  const decisions = entries.filter(e => e.type === "decision");
  const contract  = readJSON("inferno/contract.json");
  const frozen    = (contract?.capabilities || []).filter(c => c.status === "frozen" || c.frozen);

  // Score and filter relevant entries
  const relevantGotchas = gotchas
    .map(e => ({ ...e, score: scoreRelevance(e, changedFiles) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);

  const relevantDecisions = decisions
    .map(e => ({ ...e, score: scoreRelevance(e, changedFiles) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);

  // Check frozen caps
  const touchedFrozen = frozen.filter(cap => {
    const capId = typeof cap === "string" ? cap : cap.id;
    return changedFiles.some(f => f.toLowerCase().includes(capId?.toLowerCase()));
  });

  const hasAnything = relevantGotchas.length > 0 || relevantDecisions.length > 0 || touchedFrozen.length > 0;

  if (!hasAnything && minType !== "always") {
    return null; // nothing relevant — don't post
  }

  const lines = [
    `## 🔥 infernoflow — PR Memory Check`,
    ``,
    `> **${changedFiles.length} files changed** — here's what infernoflow remembers about these areas:`,
    ``,
  ];

  // Gotchas first — most important
  if (relevantGotchas.length > 0) {
    lines.push(`### ⚠️ Gotchas to watch out for`);
    lines.push(``);
    for (const e of relevantGotchas.slice(0, 5)) {
      const date = e.ts ? new Date(e.ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";
      lines.push(`- **${e.summary}**${date ? ` _(${date})_` : ""}`);
    }
    lines.push(``);
  }

  // Decisions
  if (relevantDecisions.length > 0 && minType !== "gotcha") {
    lines.push(`### ✅ Decisions in effect`);
    lines.push(``);
    for (const e of relevantDecisions.slice(0, 5)) {
      lines.push(`- ${e.summary}`);
    }
    lines.push(``);
  }

  // Frozen capabilities
  if (touchedFrozen.length > 0) {
    lines.push(`### 🧊 Protected components touched`);
    lines.push(``);
    for (const cap of touchedFrozen) {
      const capId = typeof cap === "string" ? cap : cap.id;
      lines.push(`- \`${capId}\` is frozen — verify it still works as expected`);
    }
    lines.push(``);
  }

  // Footer
  lines.push(`---`);
  lines.push(`<sub>🔥 [infernoflow](https://infernoflow.dev) — persistent memory for AI coding sessions · [Add to your project](https://infernoflow.dev#install)</sub>`);

  return lines.join("\n");
}

// ── Find existing infernoflow comment ─────────────────────────────────────────

async function findExistingComment(owner, repo, prNumber, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`;
  const res = await httpsGet(url, { Authorization: `token ${token}` });
  if (res.status !== 200) return null;
  const comments = JSON.parse(res.body);
  return comments.find(c => c.body?.includes("infernoflow — PR Memory Check")) || null;
}

async function upsertComment(owner, repo, prNumber, token, body) {
  const existing = await findExistingComment(owner, repo, prNumber, token);

  if (existing) {
    // Update existing comment
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`;
    const res = await httpsPost(url.replace("POST", "PATCH"), { body }, { Authorization: `token ${token}` });
    // Use PATCH via a workaround
    return fetch ? null : null; // handled below via raw https PATCH
  }

  // Post new comment
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const res = await httpsPost(url, { body }, { Authorization: `token ${token}` });
  return res;
}

async function patchComment(owner, repo, commentId, token, body) {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify({ body });
    const parsed  = new URL(`https://api.github.com/repos/${owner}/${repo}/issues/comments/${commentId}`);
    const opts    = {
      hostname: parsed.hostname,
      path:     parsed.pathname,
      method:   "PATCH",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(data),
        "User-Agent":     "infernoflow-action/1.0",
        "Authorization":  `token ${token}`,
      },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const token       = process.env.INPUT_GITHUBTOKEN || process.env.GITHUB_TOKEN;
  const sessFile    = process.env["INPUT_SESSIONS-FILE"] || "inferno/sessions.jsonl";
  const minType     = process.env["INPUT_MIN-TYPE"] || "both";
  const failFrozen  = process.env["INPUT_FAIL-ON-FROZEN"] === "true";
  const eventPath   = process.env.GITHUB_EVENT_PATH;
  const repository  = process.env.GITHUB_REPOSITORY || "";

  if (!token) {
    console.error("❌ GITHUB_TOKEN not set");
    process.exit(1);
  }

  // Load event
  const event = eventPath && fs.existsSync(eventPath) ? readJSON(eventPath) : null;
  const prNumber = event?.pull_request?.number || event?.number;

  if (!prNumber) {
    console.log("ℹ Not a PR event — skipping");
    process.exit(0);
  }

  const [owner, repo] = repository.split("/");

  console.log(`🔥 infernoflow action — PR #${prNumber} in ${repository}`);

  // Load session memory
  const entries = readJSONL(sessFile);
  if (!entries.length) {
    console.log("ℹ No session entries found — nothing to report");
    process.exit(0);
  }

  console.log(`  Loaded ${entries.length} entries from ${sessFile}`);

  // Get changed files
  const changedFiles = await getChangedFiles(owner, repo, prNumber, token);
  console.log(`  PR touches ${changedFiles.length} files`);

  // Build comment
  const comment = buildComment(entries, changedFiles, prNumber, minType);

  if (!comment) {
    console.log("  ✔ No relevant gotchas or decisions for these files — no comment posted");
    process.exit(0);
  }

  // Post or update comment
  const existing = await findExistingComment(owner, repo, prNumber, token);
  let result;
  if (existing) {
    result = await patchComment(owner, repo, existing.id, token, comment);
    console.log(`  ✔ Updated existing infernoflow comment (id: ${existing.id})`);
  } else {
    result = await httpsPost(
      `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
      { body: comment },
      { Authorization: `token ${token}` }
    );
    console.log(`  ✔ Posted new PR comment (status: ${result.status})`);
  }

  // Fail on frozen if requested
  const contract     = readJSON("inferno/contract.json");
  const frozen       = (contract?.capabilities || []).filter(c => c.status === "frozen" || c.frozen);
  const touchedFrozen = frozen.filter(cap => {
    const capId = typeof cap === "string" ? cap : cap.id;
    return changedFiles.some(f => f.toLowerCase().includes(capId?.toLowerCase()));
  });

  if (failFrozen && touchedFrozen.length > 0) {
    console.error(`❌ ${touchedFrozen.length} frozen capability/capabilities touched — failing as requested`);
    process.exit(1);
  }

  console.log("  🔥 Done");
}

main().catch(err => {
  console.error("❌ Action failed:", err.message);
  process.exit(1);
});

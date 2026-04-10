import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { header, section, ok, warn, fail, gray, cyan, yellow } from "../ui/output.mjs";

const CODE_PREFIXES = ["src/", "frontend/", "backend/", "app/", "pages/", "components/", "lib/", "api/", "server/", "Controllers/"];

function sh(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readFile(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

function getChangedFiles(base, head) {
  const out = base && head
    ? sh(`git diff --name-only ${base}..${head}`)
    : sh("git diff --name-only HEAD");
  return out ? out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

function buildCapabilityHints(cwd) {
  const infernoDir = path.join(cwd, "inferno");
  const contract = readJson(path.join(infernoDir, "contract.json"), { capabilities: [] });
  const registry = readJson(path.join(infernoDir, "capabilities.json"), { capabilities: [] });
  const titleById = new Map((registry.capabilities || []).map((c) => [c.id, c.title || c.id]));
  return (contract.capabilities || []).map((id) => {
    const title = titleById.get(id) || id;
    const keywords = new Set(
      `${id} ${title}`
        .replace(/([A-Z])/g, " $1")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((k) => k.length >= 4)
    );
    return { id, title, keywords: Array.from(keywords) };
  });
}

function inferImpactedCapabilities(cwd, changedCodeFiles) {
  const hints = buildCapabilityHints(cwd);
  const impacted = [];
  for (const hint of hints) {
    const matched = [];
    for (const rel of changedCodeFiles) {
      const abs = path.join(cwd, rel);
      const text = readFile(abs, "").toLowerCase();
      if (!text) continue;
      if (hint.keywords.some((k) => text.includes(k))) {
        matched.push(rel);
      }
    }
    if (matched.length) {
      impacted.push({ id: hint.id, title: hint.title, matchedFiles: matched.slice(0, 5) });
    }
  }
  return impacted;
}

export async function prImpactCommand(args = []) {
  const asJson = args.includes("--json");
  const cwd = process.cwd();
  const base = process.env.BASE_SHA || null;
  const head = process.env.HEAD_SHA || null;

  let changedFiles = [];
  try {
    changedFiles = getChangedFiles(base, head);
  } catch {
    const payload = { ok: true, skipped: true, reason: "no_git_available" };
    if (asJson) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    header("pr-impact");
    warn("git not available; cannot compute PR impact");
    console.log();
    return;
  }

  const changedCodeFiles = changedFiles.filter((f) => CODE_PREFIXES.some((p) => f.startsWith(p)));
  const changedInfernoFiles = changedFiles.filter((f) => f.startsWith("inferno/"));
  const impactedCapabilities = inferImpactedCapabilities(cwd, changedCodeFiles);
  const inferredBehaviorChange = changedCodeFiles.length > 0;
  const missingInfernoUpdate = inferredBehaviorChange && changedInfernoFiles.length === 0;
  const confidence = impactedCapabilities.length > 0 ? "high" : inferredBehaviorChange ? "medium" : "low";
  const reasonCodes = [];
  if (inferredBehaviorChange) reasonCodes.push("CODE_CHANGED");
  if (missingInfernoUpdate) reasonCodes.push("INFERNO_NOT_UPDATED");
  if (impactedCapabilities.length > 0) reasonCodes.push("CAPABILITY_HINT_MATCH");
  if (!reasonCodes.length) reasonCodes.push("NO_BEHAVIOR_SIGNAL");

  const payload = {
    ok: !missingInfernoUpdate,
    base: base || "HEAD",
    head: head || "WORKTREE",
    changedFiles,
    changedCodeFiles,
    changedInfernoFiles,
    inferredBehaviorChange,
    impactedCapabilities,
    confidence,
    reasonCodes,
    recommendations: missingInfernoUpdate
      ? ["Run infernoflow suggest \"describe behavior change\" and update inferno/", "Run infernoflow check --json"]
      : ["Run infernoflow check --json to validate final state"],
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    process.exit(payload.ok ? 0 : 1);
  }

  header("pr-impact");

  section("Diff Scope");
  ok(`Changed files: ${cyan(String(changedFiles.length))}`);
  ok(`Code files: ${cyan(String(changedCodeFiles.length))}`);
  ok(`Inferno files: ${cyan(String(changedInfernoFiles.length))}`);

  section("Capability Impact");
  if (impactedCapabilities.length === 0) {
    warn("No capability hints matched changed code files");
  } else {
    impactedCapabilities.forEach((c) => {
      console.log(`  ${cyan("•")} ${c.id} ${gray(`(${c.title})`)}`);
      c.matchedFiles.slice(0, 3).forEach((f) => console.log(`      ${gray("- " + f)}`));
    });
  }

  section("Doc Sync");
  if (missingInfernoUpdate) {
    fail("Code changed but inferno/ was not updated", "Run infernoflow suggest and then infernoflow check");
  } else {
    ok("No immediate inferno drift signal from changed files");
  }
  ok(`Confidence: ${cyan(confidence)}`);

  section("Suggested Next");
  payload.recommendations.forEach((r) => console.log(`  ${yellow("→")} ${r}`));
  console.log();
  process.exit(payload.ok ? 0 : 1);
}


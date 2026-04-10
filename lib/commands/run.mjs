import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateWithLocalModel } from "../ai/localProvider.mjs";
import {
  buildPrompt,
  loadSuggestContext,
  parseSuggestionJson,
  validateSuggestion,
  detectSuggestionConflicts,
  applyChanges,
} from "./suggest.mjs";
import { header, section, ok, warn, fail, info, gray } from "../ui/output.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binPath = path.resolve(__dirname, "..", "..", "bin", "infernoflow.mjs");

function runCliJson(args) {
  try {
    const out = execFileSync(process.execPath, [binPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, data: JSON.parse(out) };
  } catch (err) {
    const stdout = err?.stdout?.toString?.() || "";
    try {
      return { ok: false, data: JSON.parse(stdout) };
    } catch {
      return { ok: false, data: { ok: false, errors: ["command_failed"] } };
    }
  }
}

function stageEvent(asJson, events, stage, status, details = {}) {
  const ev = { ts: new Date().toISOString(), stage, status, ...details };
  events.push(ev);
  if (asJson) return;
  const text = `${stage}: ${status}`;
  if (status === "ok") ok(text);
  else if (status === "warn") warn(text);
  else if (status === "fail") fail(text);
  else info(text);
}

function snapshotInferno(cwd) {
  const infernoDir = path.join(cwd, "inferno");
  const targets = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else targets.push(p);
    }
  };
  if (fs.existsSync(infernoDir)) walk(infernoDir);
  const snapshot = new Map();
  targets.forEach((filePath) => snapshot.set(filePath, fs.readFileSync(filePath, "utf8")));
  return snapshot;
}

function restoreSnapshot(cwd, snapshot) {
  const infernoDir = path.join(cwd, "inferno");
  if (fs.existsSync(infernoDir)) {
    const existing = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else existing.push(p);
      }
    };
    walk(infernoDir);
    existing.forEach((filePath) => {
      if (!snapshot.has(filePath)) fs.unlinkSync(filePath);
    });
  }
  for (const [filePath, content] of snapshot.entries()) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function writeRunArtifact(cwd, artifact) {
  const runsDir = path.join(cwd, "inferno", "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const filePath = path.join(runsDir, `${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  return path.relative(cwd, filePath);
}

export async function runCommand(args = []) {
  const asJson = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const noRollback = args.includes("--no-rollback");
  const task = args.filter((a) => !a.startsWith("-")).slice(1).join(" ").trim() || "sync check";
  const cwd = process.cwd();
  const events = [];

  if (!asJson) header("run");
  stageEvent(asJson, events, "init", "info", { task, dryRun, noRollback });

  // detect
  const impact = runCliJson(["pr-impact", "--json"]);
  stageEvent(asJson, events, "detect", impact.data?.ok ? "ok" : "warn", { confidence: impact.data?.confidence || "low" });

  const ctx = loadSuggestContext(cwd);
  if (!ctx?.contract) {
    const payload = { ok: false, error: "inferno_missing", events };
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else fail("inferno/ missing or invalid");
    process.exit(1);
  }

  // propose
  const prompt = buildPrompt({
    description: task,
    contract: ctx.contract,
    capabilities: ctx.capabilities,
    scenarios: ctx.scenarios,
  });
  let suggestion;
  try {
    const raw = await generateWithLocalModel(prompt);
    suggestion = parseSuggestionJson(raw);
  } catch (err) {
    const payload = { ok: false, error: "local_model_failed", reason: String(err.message || err), events };
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else fail(`local model failed`, err.message);
    process.exit(1);
  }
  stageEvent(asJson, events, "propose", "ok", {
    newCapabilities: (suggestion.newCapabilities || []).length,
    removedCapabilities: (suggestion.removedCapabilities || []).length,
  });

  const schemaErrors = validateSuggestion(suggestion);
  const conflictErrors = detectSuggestionConflicts(ctx.contract, suggestion);
  if (schemaErrors.length || conflictErrors.length) {
    const payload = {
      ok: false,
      error: "invalid_suggestion",
      issues: [...schemaErrors, ...conflictErrors],
      events,
    };
    if (asJson) console.log(JSON.stringify(payload, null, 2));
    else fail("suggestion invalid", payload.issues[0]);
    process.exit(1);
  }

  const snapshot = snapshotInferno(cwd);
  let rolledBack = false;
  let applyChanged = false;
  let validationPassed = false;

  try {
    if (dryRun) {
      stageEvent(asJson, events, "apply", "info", { dryRun: true });
    } else {
      applyChanged = applyChanges({
        cwd,
        contract: ctx.contract,
        capabilities: ctx.capabilities,
        suggestion,
        version: ctx.version,
        quiet: asJson,
      });
      stageEvent(asJson, events, "apply", "ok", { changed: applyChanged });
    }

    let check = runCliJson(["check", "--json"]);
    if (process.env.INFERNO_TEST_FORCE_VALIDATE_FAIL === "1") {
      check = { ok: false, data: { ok: false, errors: ["forced_validation_failure"] } };
    }
    if (!check.ok || !check.data?.ok) {
      throw new Error(`validation_failed:${(check.data?.errors || []).join(",")}`);
    }
    validationPassed = true;
    stageEvent(asJson, events, "validate", "ok");
  } catch (err) {
    stageEvent(asJson, events, "validate", "fail", { reason: String(err.message || err) });
    if (!dryRun && !noRollback) {
      restoreSnapshot(cwd, snapshot);
      rolledBack = true;
      stageEvent(asJson, events, "rollback", "ok");
    }
  }

  const artifact = {
    task,
    dryRun,
    noRollback,
    rolledBack,
    applyChanged,
    suggestionSummary: suggestion.summary || "",
    touchedCapabilities: [
      ...(suggestion.newCapabilities || []).map((c) => c.id),
      ...(suggestion.removedCapabilities || []),
    ],
    events,
  };
  const artifactPath = writeRunArtifact(cwd, artifact);

  const payload = {
    ok: validationPassed,
    mode: "run",
    task,
    dryRun,
    rolledBack,
    applyChanged,
    artifactPath,
    events,
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    process.exit(payload.ok ? 0 : 1);
  }

  section("Result");
  info(`task: ${gray(task)}`);
  info(`artifact: ${gray(artifactPath)}`);
  if (payload.ok) ok("run completed");
  else warn("run rolled back after failed validation");
  console.log();
  process.exit(payload.ok ? 0 : 1);
}


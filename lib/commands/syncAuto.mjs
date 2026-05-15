import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { header, section, ok, warn, yellow, gray } from "../ui/output.mjs";

/**
 * Detect drift between inferno/contract.json and inferno/CONTEXT.md.
 *
 * Before this existed, `sync --auto` only checked git-diff impact via
 * `pr-impact` and missed the most obvious case: someone updated the contract
 * (renamed a capability, bumped policyId, edited capabilities.json) but
 * never regenerated CONTEXT.md. The reviewer hit this — CONTEXT.md still
 * claimed `forgetasks v8` while the contract had moved on. Sync said
 * "no drift detected" anyway.
 *
 * Returns null when no contract exists (nothing to drift against) or an
 * array of human-readable mismatch strings.
 */
function detectContextMdDrift(cwd) {
  const contractPath = path.join(cwd, "inferno", "contract.json");
  const contextPath  = path.join(cwd, "inferno", "CONTEXT.md");

  if (!fs.existsSync(contractPath)) return null;
  if (!fs.existsSync(contextPath))  return ["CONTEXT.md is missing"];

  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  } catch (err) {
    return [`contract.json unreadable: ${err.message}`];
  }

  const contextContent = fs.readFileSync(contextPath, "utf8");
  const mismatches = [];

  // 1. policyId — the H1 header should mention it. Reviewers hit this when
  //    the contract was renamed but the header wasn't.
  if (contract.policyId) {
    const h1Match = contextContent.match(/^#\s+([^\n]+)/m);
    const h1      = h1Match ? h1Match[1] : "";
    if (!h1.includes(contract.policyId)) {
      mismatches.push(`H1 "${h1}" doesn't match policyId "${contract.policyId}"`);
    }
  }

  // 2. policyVersion — if CONTEXT.md mentions a version-like token (vN, v1.0),
  //    and contract has a numeric policyVersion, flag the mismatch. Skip if
  //    no version-like token is present at all (legitimately versionless).
  if (typeof contract.policyVersion === "number") {
    const versionMatch = contextContent.match(/\bv(\d+(?:\.\d+)?)\b/i);
    if (versionMatch) {
      const ctxVersion = parseFloat(versionMatch[1]);
      if (ctxVersion !== contract.policyVersion) {
        mismatches.push(`CONTEXT.md references v${ctxVersion} but contract is v${contract.policyVersion}`);
      }
    }
  }

  // 3. Capability list — every capability id in contract.capabilities should
  //    appear somewhere in CONTEXT.md. Missing capabilities = stale doc.
  const capIds = Array.isArray(contract.capabilities)
    ? contract.capabilities.map(c => typeof c === "string" ? c : c.id).filter(Boolean)
    : [];
  const missing = capIds.filter(id => !contextContent.includes(id));
  if (missing.length > 0) {
    mismatches.push(`CONTEXT.md is missing capabilities: ${missing.join(", ")}`);
  }

  return mismatches.length > 0 ? mismatches : [];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const binPath = path.resolve(__dirname, "..", "..", "bin", "infernoflow.mjs");

function runCliJson(args) {
  const out = execFileSync(process.execPath, [binPath, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out);
}

function tryRunCliJson(args) {
  try {
    return { ok: true, data: runCliJson(args) };
  } catch (err) {
    const stdout = err?.stdout?.toString?.() || "";
    try {
      return { ok: false, data: JSON.parse(stdout) };
    } catch {
      return { ok: false, data: { ok: false, errors: ["command_failed"] } };
    }
  }
}

export async function syncCommand(args = []) {
  const auto = args.includes("--auto");
  const asJson = args.includes("--json");
  const dryRun = args.includes("--dry-run");

  if (!auto) {
    const payload = { ok: false, error: "missing_required_flag", hint: "Use: infernoflow sync --auto" };
    if (asJson) {
      console.log(JSON.stringify(payload, null, 2));
      process.exit(1);
    }
    header("sync");
    warn("missing --auto flag");
    console.log(`  ${yellow("→")} infernoflow sync --auto`);
    console.log();
    process.exit(1);
  }

  const impact = tryRunCliJson(["pr-impact", "--json"]);
  // Two drift signals now:
  //   1. pr-impact (git-diff vs contract)  — what we always had
  //   2. CONTEXT.md vs contract.json       — NEW; catches the case the
  //      reviewer hit, where the contract was updated but CONTEXT.md was
  //      forgotten. Sync used to say "no drift" with stale docs.
  const ctxDrift = detectContextMdDrift(process.cwd()) || [];
  const ctxDriftDetected = ctxDrift.length > 0;
  const needsSync = !impact.data?.ok || ctxDriftDetected;
  const confidence = impact.data?.confidence || "low";
  const policyDecision = confidence === "high" ? "auto" : confidence === "medium" ? "ask" : "block";
  const actions = needsSync
    ? [
        ...(ctxDriftDetected ? ["Regenerate CONTEXT.md via `infernoflow context`"] : []),
        "Generate inferno update proposal (suggest)",
        "Review changes",
        "Validate with check --json",
      ]
    : ["No inferno drift detected", "Validate with check --json"];

  const check = tryRunCliJson(["check", "--json"]);
  const payload = {
    ok: impact.ok && check.ok && !!check.data?.ok,
    mode: "auto-skeleton",
    dryRun,
    needsSync,
    didApply: false,
    confidence,
    policyDecision,
    actions,
    prImpact: impact.data,
    postCheck: check.data,
    contextDrift: ctxDrift,
    reasonCodes: [
      ...(needsSync ? ["DRIFT_DETECTED"] : ["NO_DRIFT"]),
      ...(ctxDriftDetected ? ["CONTEXT_MD_STALE"] : []),
      `POLICY_${policyDecision.toUpperCase()}`,
      ...(policyDecision === "auto" ? ["AUTO_APPLY_DISABLED_IN_SKELETON"] : []),
    ],
  };

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
    process.exit(payload.ok ? 0 : 1);
  }

  header("sync --auto");
  section("State");
  if (needsSync) warn("Inferno drift detected");
  else ok("No inferno drift detected");
  if (ctxDriftDetected) {
    for (const m of ctxDrift) warn(`CONTEXT.md drift: ${m}`);
  }
  ok(`Confidence: ${gray(confidence)}`);
  ok(`Policy decision: ${gray(policyDecision)}`);
  ok(`Apply mode: ${gray("skeleton (no file writes)")}`);
  if (dryRun) ok("Dry run enabled");

  section("Plan");
  actions.forEach((a) => console.log(`  ${yellow("→")} ${a}`));

  section("Validation");
  if (check.ok && check.data?.ok) ok("Post-check passed");
  else warn("Post-check failed; see infernoflow check --json");
  console.log();
  process.exit(payload.ok ? 0 : 1);
}


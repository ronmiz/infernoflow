import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { header, section, ok, warn, yellow, gray } from "../ui/output.mjs";

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
  const needsSync = !impact.data?.ok;
  const confidence = impact.data?.confidence || "low";
  const policyDecision = confidence === "high" ? "auto" : confidence === "medium" ? "ask" : "block";
  const actions = needsSync
    ? ["Generate inferno update proposal (suggest)", "Review changes", "Validate with check --json"]
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
    reasonCodes: [
      ...(needsSync ? ["DRIFT_DETECTED"] : ["NO_DRIFT"]),
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


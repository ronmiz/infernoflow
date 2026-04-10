import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = join(__dirname, "..", "bin", "infernoflow.mjs");

function run(cwd, args, env = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function sh(cwd, cmd, args) {
  const res = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (res.status !== 0) throw new Error(`${cmd} failed: ${res.stderr}`);
}

const root = mkdtempSync(join(tmpdir(), "infernoflow-run-"));
try {
  sh(root, "git", ["init"]);
  sh(root, "git", ["config", "user.email", "smoke@example.com"]);
  sh(root, "git", ["config", "user.name", "Smoke Test"]);

  mkdirSync(join(root, "inferno", "scenarios"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.js"), "export const v = 1;\n", "utf8");
  writeFileSync(
    join(root, "inferno", "contract.json"),
    JSON.stringify({ policyId: "smoke", policyVersion: 1, capabilities: ["CreateTask"], rules: { requireScenarioForEachCapability: true } }, null, 2) + "\n",
    "utf8"
  );
  writeFileSync(
    join(root, "inferno", "capabilities.json"),
    JSON.stringify({ schemaVersion: 1, capabilities: [{ id: "CreateTask", title: "Create Task", since: "0.1.0" }] }, null, 2) + "\n",
    "utf8"
  );
  writeFileSync(
    join(root, "inferno", "scenarios", "happy_path.json"),
    JSON.stringify({ scenarioId: "happy_path", capabilitiesCovered: ["CreateTask"], steps: [{ action: "CreateTask", expect: "ok" }] }, null, 2) + "\n",
    "utf8"
  );
  writeFileSync(join(root, "inferno", "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n", "utf8");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "run-smoke", version: "1.0.0" }, null, 2) + "\n", "utf8");

  sh(root, "git", ["add", "."]);
  sh(root, "git", ["commit", "-m", "baseline"]);

  const okResponse = JSON.stringify({
    summary: "favorite behavior",
    newCapabilities: [{ id: "SetTaskFavorite", title: "Set Task Favorite", reason: "new behavior" }],
    removedCapabilities: [],
    updatedScenarios: [
      {
        file: "happy_path.json",
        isNew: false,
        capabilitiesCovered: ["SetTaskFavorite"],
        stepsToAdd: [{ action: "SetTaskFavorite", expect: "works" }],
      },
    ],
    changelogEntry: "- Added favorite behavior",
  });

  // Auto -> agent path
  const okRun = run(root, ["run", "add favorite badge", "--json"], {
    INFERNO_AGENT_AVAILABLE: "1",
    INFERNO_AGENT_MOCK_RESPONSE: okResponse,
  });
  if (okRun.status !== 0) throw new Error("run --json success path should pass");
  const okParsed = JSON.parse(okRun.stdout);
  if (!okParsed.ok) throw new Error("run payload ok expected true");
  if (okParsed.providerResolved !== "agent") throw new Error("auto should resolve to agent when available");
  if (!okParsed.artifactPath || !existsSync(join(root, okParsed.artifactPath))) {
    throw new Error("run artifact missing");
  }

  // Auto -> prompt fallback path
  const promptRun = run(root, ["run", "headless flow", "--json"], {
    INFERNO_AGENT_AVAILABLE: "0",
  });
  if (promptRun.status !== 0) throw new Error("prompt fallback path should pass");
  const promptParsed = JSON.parse(promptRun.stdout);
  if (promptParsed.providerResolved !== "prompt") throw new Error("auto should fallback to prompt");
  if (!promptParsed.reasonCodes.includes("FALLBACK_PROMPT_MODE")) throw new Error("missing prompt fallback reason code");

  // Explicit agent failure path
  const explicitAgent = run(root, ["run", "force agent", "--provider", "agent", "--json"], {
    INFERNO_AGENT_AVAILABLE: "0",
  });
  if (explicitAgent.status === 0) throw new Error("explicit agent should fail when unavailable");
  const explicitAgentParsed = JSON.parse(explicitAgent.stdout);
  if (!explicitAgentParsed.reasonCodes.includes("EXPLICIT_AGENT_REQUIRED")) {
    throw new Error("missing explicit agent reason code");
  }

  // Explicit local path
  const localResponse = JSON.stringify({
    summary: "archive behavior",
    newCapabilities: [{ id: "ArchiveTask", title: "Archive Task", reason: "new behavior" }],
    removedCapabilities: [],
    updatedScenarios: [
      {
        file: "happy_path.json",
        isNew: false,
        capabilitiesCovered: ["ArchiveTask"],
        stepsToAdd: [{ action: "ArchiveTask", expect: "works" }],
      },
    ],
    changelogEntry: "- Added archive behavior",
  });
  const localRun = run(root, ["run", "local route", "--provider", "local", "--json"], {
    INFERNO_LOCAL_MOCK_RESPONSE: localResponse,
  });
  if (localRun.status !== 0) throw new Error("explicit local should pass");
  const localParsed = JSON.parse(localRun.stdout);
  if (localParsed.providerResolved !== "local") throw new Error("provider local should resolve local");
  if (!localParsed.reasonCodes.includes("LOCAL_PROVIDER_SELECTED")) throw new Error("missing local provider reason code");

  // Rollback path
  const contractBefore = readFileSync(join(root, "inferno", "contract.json"), "utf8");
  const failRun = run(root, ["run", "force fail validate", "--json"], {
    INFERNO_AGENT_AVAILABLE: "1",
    INFERNO_AGENT_MOCK_RESPONSE: JSON.stringify({
      summary: "pin behavior",
      newCapabilities: [{ id: "SetTaskPinned", title: "Set Task Pinned", reason: "new behavior" }],
      removedCapabilities: [],
      updatedScenarios: [
        {
          file: "happy_path.json",
          isNew: false,
          capabilitiesCovered: ["SetTaskPinned"],
          stepsToAdd: [{ action: "SetTaskPinned", expect: "works" }],
        },
      ],
      changelogEntry: "- Added pin behavior",
    }),
    INFERNO_TEST_FORCE_VALIDATE_FAIL: "1",
  });
  if (failRun.status === 0) throw new Error("run should fail when forced validation fails");
  const failParsed = JSON.parse(failRun.stdout);
  if (failParsed.rolledBack !== true) throw new Error("expected rolledBack=true");
  const contractAfter = readFileSync(join(root, "inferno", "contract.json"), "utf8");
  if (contractAfter !== contractBefore) throw new Error("rollback should restore inferno files");

  console.log("run smoke checks passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}


// Zero-dependency interactive prompts using readline

import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

function ask(question, defaultVal = "") {
  return new Promise(resolve => {
    const hint = defaultVal ? ` (${defaultVal})` : "";
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${question}${hint}: `, answer => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

export async function promptInit() {
  const policyId = await ask("Project / policy name", process.env._INFERNO_DEFAULT_POLICY || "my-project");
  const caps = await ask("Capabilities (comma-separated)", "CreateTask, ReadTasks, UpdateTask, DeleteTask");
  return { policyId, capabilities: caps.split(",").map(c => c.trim()).filter(Boolean) };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function loadImplementContext(cwd) {
  const infernoDir = path.join(cwd, "inferno");
  const contract = readJson(path.join(infernoDir, "contract.json")) || {};
  const caps = readJson(path.join(infernoDir, "capabilities.json")) || { capabilities: [] };
  const state = readJson(path.join(infernoDir, "context-state.json")) || {};
  const scenariosDir = path.join(infernoDir, "scenarios");

  const scenarios = [];
  if (fs.existsSync(scenariosDir)) {
    for (const fileName of fs.readdirSync(scenariosDir).filter((f) => f.endsWith(".json"))) {
      const scenario = readJson(path.join(scenariosDir, fileName));
      if (scenario) scenarios.push({ file: fileName, scenario });
    }
  }

  return { contract, caps, state, scenarios };
}

function renderCaps(capsRegistry) {
  const list = capsRegistry?.capabilities || [];
  if (list.length === 0) return "- none";
  return list.map((c) => `- ${c.id}: ${c.title || c.id}`).join("\n");
}

function renderScenarios(scenarios) {
  if (!scenarios || scenarios.length === 0) return "- none";
  return scenarios
    .map(({ file, scenario }) => {
      const covered = (scenario.capabilitiesCovered || []).join(", ") || "none";
      return `- ${file}: covers [${covered}]`;
    })
    .join("\n");
}

function baseContextBlock({ contract, caps, scenarios, state }) {
  const policy = contract?.policyId || "unknown-policy";
  const version = contract?.policyVersion ?? "unknown";
  const declared = (contract?.capabilities || []).join(", ") || "none";
  const working = state?.working || "not set";
  const intent = state?.intent || "not set";

  return [
    `Project policyId: ${policy}`,
    `Policy version: ${version}`,
    `Declared capabilities: [${declared}]`,
    `Working on: ${working}`,
    `Intent: ${intent}`,
    "",
    "Capabilities registry:",
    renderCaps(caps),
    "",
    "Scenarios:",
    renderScenarios(scenarios),
  ].join("\n");
}

export function buildCursorImplementPrompt({ task, contract, caps, scenarios, state }) {
  return [
    "You are a Cursor coding agent working inside my repository.",
    "Implement the task end-to-end with minimal reliable changes.",
    "",
    baseContextBlock({ contract, caps, scenarios, state }),
    "",
    `Task: ${task}`,
    "",
    "Requirements:",
    "1) Propose smallest safe implementation.",
    "2) Explain which files you changed and why.",
    "3) Implement production-ready code.",
    "4) Preserve backward compatibility unless explicitly requested.",
    "5) Update tests or add smoke checks.",
    "6) Provide run/verify commands.",
    "7) If assumptions are needed, state briefly and proceed with sensible defaults.",
    "",
    "Output format:",
    "- Plan (short)",
    "- Code changes (by file)",
    "- Tests updated/added",
    "- Commands to run",
    "- Acceptance checklist",
    "",
    "Quality bar:",
    "- No TODO placeholders in final code",
    "- Handle edge cases and errors",
    "- Keep naming/style consistent",
    "- Prefer simple maintainable solutions",
    "",
    "If model is overloaded (resource exhausted), retry with Auto/another model and continue deterministically.",
  ].join("\n");
}

export function buildGenericImplementPrompt({ task, contract, caps, scenarios, state }) {
  return [
    "You are my senior software engineer pair.",
    "Implement this task end-to-end in my project.",
    "",
    baseContextBlock({ contract, caps, scenarios, state }),
    "",
    `Goal: ${task}`,
    "",
    "Deliverables:",
    "- Short implementation plan",
    "- Exact file-level changes",
    "- Test updates",
    "- Verification commands",
    "- Final acceptance checklist",
    "",
    "Constraints:",
    "- Keep backward compatibility by default",
    "- Make minimal reliable changes",
    "- Handle edge cases and error states",
    "- Keep output concise and actionable",
    "",
    "If you encounter temporary model high-load errors, retry and preserve the same output structure.",
  ].join("\n");
}

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function sendResult(id, result) { send({ jsonrpc: "2.0", id, result }); }
function sendError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

/**
 * Run the infernoflow CLI. Returns either the stdout string OR a structured
 * error object so call sites can decide whether to surface it via JSON-RPC
 * sendError() instead of returning gibberish text to the agent.
 */
function runCmd(args, env = {}) {
  try {
    return execSync(`npx infernoflow ${args}`, {
      encoding: "utf8",
      cwd: process.cwd(),
      timeout: 30000,
      env: { ...process.env, ...env },
    });
  } catch (err) {
    return {
      __error: true,
      message: err.message || "command failed",
      stderr: err.stderr || "",
      stdout: err.stdout || "",
      status: err.status ?? 1,
    };
  }
}

/** True if a runCmd() result is actually a structured error. */
function isCmdError(result) {
  return typeof result === "object" && result !== null && result.__error === true;
}

const TOOLS = [
  { name: "infernoflow_run", description: "Generate an infernoflow task prompt. Returns the prompt — respond to it with JSON, then call infernoflow_apply.", inputSchema: { type: "object", properties: { task: { type: "string", description: "What to build" } }, required: ["task"] } },
  { name: "infernoflow_apply", description: "Apply an infernoflow suggestion JSON returned by the agent. Call this after responding to infernoflow_run.", inputSchema: { type: "object", properties: { json: { type: "string", description: "The JSON suggestion from the agent" } }, required: ["json"] } },
  { name: "infernoflow_check", description: "Validate infernoflow contract and capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "infernoflow_status", description: "Show contract health at a glance", inputSchema: { type: "object", properties: {} } },
  { name: "infernoflow_context", description: "Generate AI-ready context", inputSchema: { type: "object", properties: { intent: { type: "string" }, working: { type: "string" } } } },
  { name: "infernoflow_git_drift", description: "Detect which capabilities may be affected by recent code changes. Compares git-changed files to the capability registry and returns suggestions for contract updates.", inputSchema: { type: "object", properties: { sinceCommits: { type: "number", description: "How many commits back to check (default: 1)" } } } },
  { name: "infernoflow_implement", description: "Generate a structured code implementation prompt for a task. Uses the contract and stack context to produce step-by-step coding instructions for the agent.", inputSchema: { type: "object", properties: { task: { type: "string", description: "What to implement" }, mode: { type: "string", enum: ["cursor", "generic", "both"], description: "Prompt style (default: both)" } }, required: ["task"] } },
  { name: "infernoflow_scan_ui", description: "Scan components and styles for UI changes vs the stored contract. Returns new/changed components, design token changes, and suggested contract updates.", inputSchema: { type: "object", properties: {} } },
  { name: "infernoflow_review", description: "Pre-merge capability drift check. Compares all changed files in the current branch against the capability contract and reports drift risk before you merge.", inputSchema: { type: "object", properties: { branch: { type: "string", description: "Branch to compare against (default: main)" } } } },

  // ── AMP-spec MCP tools (per docs/protocol/PROTOCOL.md §7.3) ────────────────
  // These are the standard names any AMP-compliant MCP server should expose.
  // They're thin wrappers around the existing infernoflow_* tools so AMP-only
  // clients don't need to know the infernoflow_ vendor prefix.
  { name: "amp_read",    description: "AMP: read session memory entries with optional filters.", inputSchema: { type: "object", properties: { file: { type: "string" }, type: { type: "string", enum: ["gotcha","decision","attempt","note","detection","pattern"] }, query: { type: "string" }, limit: { type: "number" } } } },
  { name: "amp_write",   description: "AMP: log a new entry. Required: type + msg. Optional: file, line, tags.", inputSchema: { type: "object", properties: { type: { type: "string", enum: ["gotcha","decision","attempt","note","detection","pattern"] }, msg: { type: "string" }, file: { type: "string" }, line: { type: "number" }, tags: { type: "array", items: { type: "string" } } }, required: ["type","msg"] } },
  { name: "amp_handoff", description: "AMP: generate the handoff document for the next AI session. format=markdown|json (default: markdown).", inputSchema: { type: "object", properties: { format: { type: "string", enum: ["markdown","json"] } } } },
  { name: "amp_search",  description: "AMP: search entries by keyword. Optional type filter.", inputSchema: { type: "object", properties: { query: { type: "string" }, type: { type: "string", enum: ["gotcha","decision","attempt","note","detection","pattern"] } }, required: ["query"] } },
  { name: "amp_health",  description: "AMP: get the session health score (0-100, A-F grade).", inputSchema: { type: "object", properties: {} } },
];

// ── git drift detection (inline — no external imports in this template file) ─
function detectGitDrift(sinceCommits) {
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");

  const runGit = (cmd) => {
    try { return execSync(cmd, { cwd, encoding: "utf8", timeout: 10_000 }); }
    catch { return ""; }
  };

  const changedSet = new Set();
  const addLines = (out) => out.split("\n").map(l => l.trim()).filter(Boolean).forEach(f => changedSet.add(f));

  addLines(runGit("git diff --name-only HEAD"));
  addLines(runGit(`git diff --name-only HEAD~${sinceCommits} HEAD`));
  addLines(runGit("git ls-files --others --exclude-standard"));

  const changedFiles = Array.from(changedSet).sort();
  if (!changedFiles.length) return "No changed files detected since last commit.";

  // Load capabilities registry
  let capabilities = [];
  try {
    const capsPath = path.join(infernoDir, "capabilities.json");
    if (fs.existsSync(capsPath)) capabilities = JSON.parse(fs.readFileSync(capsPath, "utf8")).capabilities || [];
  } catch {}

  // Load capability-map if present
  let capMap = null;
  try {
    const mapPath = path.join(infernoDir, "capability-map.json");
    if (fs.existsSync(mapPath)) capMap = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  } catch {}

  const capHits = new Map();
  const mappedFiles = new Set();

  const addHit = (capId, capTitle, file) => {
    if (!capHits.has(capId)) capHits.set(capId, { id: capId, title: capTitle || capId, files: new Set() });
    capHits.get(capId).files.add(file);
    mappedFiles.add(file);
  };

  // Strategy 1: capability-map.json
  if (capMap) {
    for (const file of changedFiles) {
      for (const [prefix, capIds] of Object.entries(capMap)) {
        if (file.startsWith(prefix.replace(/\\/g, "/"))) {
          for (const capId of capIds) {
            const cap = capabilities.find(c => c.id === capId);
            addHit(capId, cap?.title, file);
          }
        }
      }
    }
  }

  // Strategy 2: heuristic keyword matching on filename
  const RULES = [
    { kw: ["search"], id: "SearchItems" }, { kw: ["filter"], id: "FilterItems" },
    { kw: ["auth", "login", "logout"], id: "Authentication" },
    { kw: ["create", "add", "new"], id: "CreateItem" },
    { kw: ["update", "edit"], id: "UpdateItem" },
    { kw: ["delete", "remove"], id: "DeleteItem" },
    { kw: ["list", "read", "view"], id: "ReadItems" },
    { kw: ["due", "deadline"], id: "SetDueDate" },
    { kw: ["priority"], id: "SetPriority" },
    { kw: ["complete", "toggle"], id: "ToggleComplete" },
  ];
  for (const file of changedFiles) {
    if (mappedFiles.has(file)) continue;
    const lower = file.toLowerCase();
    for (const rule of RULES) {
      if (rule.kw.some(k => lower.includes(k))) {
        const cap = capabilities.find(c => c.id === rule.id);
        addHit(rule.id, cap?.title, file);
        break;
      }
    }
  }

  const unmapped = changedFiles.filter(f => !mappedFiles.has(f));
  const affected = Array.from(capHits.values());

  // Format output
  const lines = [
    `## infernoflow git drift report`,
    `Changed files: ${changedFiles.length}`,
    `Affected capabilities: ${affected.length}`,
    "",
  ];

  if (affected.length) {
    lines.push("### Capabilities likely needing contract review:");
    for (const cap of affected) {
      lines.push(`\n**${cap.id}** — ${cap.title}`);
      for (const f of cap.files) lines.push(`  - ${f}`);
    }
    lines.push("");
    lines.push("### Suggested action:");
    lines.push(`Call infernoflow_run with task "review changes to ${affected.map(c => c.id).join(", ")}" to update the contract.`);
  } else {
    lines.push("No capability matches found for changed files.");
    lines.push("Consider updating inferno/capability-map.json to map your source paths to capabilities.");
  }

  if (unmapped.length) {
    lines.push(`\n### Unmapped changed files (${unmapped.length}):`);
    for (const f of unmapped.slice(0, 10)) lines.push(`  - ${f}`);
    if (unmapped.length > 10) lines.push(`  ... +${unmapped.length - 10} more`);
  }

  return lines.join("\n");
}

// ── infernoflow_scan_ui ────────────────────────────────────────────────────
function scanUi() {
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const contractPath = path.join(infernoDir, "contract.json");
  if (!fs.existsSync(contractPath)) return "inferno/ not found — run infernoflow init first";

  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const storedUi = contract.ui || {};

  // Collect style + component files
  const styleExts = /\.(css|scss|sass|less|ts|tsx|js|jsx|html)$/;
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".angular", ".next", "vendor", "coverage"]);
  const files = [];
  const walk = (dir) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!SKIP.has(entry.name)) walk(full); }
        else if (styleExts.test(entry.name) && !entry.name.includes(".min.") && !entry.name.endsWith(".map")) files.push(full);
      }
    } catch {}
  };
  for (const root of ["src", "app", "frontend", "components", "styles"]) {
    const p = path.join(cwd, root);
    if (fs.existsSync(p)) walk(p);
  }

  // Extract current components from TS/TSX files
  const currentComponents = new Set();
  const currentTokens = new Set();

  for (const f of files) {
    const text = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    // Components
    for (const m of text.matchAll(/@Component[\s\S]*?class\s+([A-Z][A-Za-z0-9_]*Component)/g)) currentComponents.add(m[1].replace(/Component$/, ""));
    for (const m of text.matchAll(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/g)) currentComponents.add(m[1]);
    // Design tokens
    for (const m of text.matchAll(/--([a-zA-Z][a-zA-Z0-9_-]*)\s*:/g)) currentTokens.add(`--${m[1]}`);
  }

  const storedComponents = new Set(storedUi.components || []);
  const storedTokens = new Set(storedUi.designTokens || []);

  const newComponents = [...currentComponents].filter(c => !storedComponents.has(c));
  const removedComponents = [...storedComponents].filter(c => !currentComponents.has(c));
  const newTokens = [...currentTokens].filter(t => !storedTokens.has(t));
  const removedTokens = [...storedTokens].filter(t => !currentTokens.has(t));

  const lines = ["## infernoflow UI scan report", ""];

  if (!newComponents.length && !removedComponents.length && !newTokens.length && !removedTokens.length) {
    lines.push("✔ No UI changes detected since last scan.");
    return lines.join("\n");
  }

  if (newComponents.length) {
    lines.push(`### New components (${newComponents.length})`);
    newComponents.slice(0, 15).forEach(c => lines.push(`  + ${c}`));
    lines.push("");
  }
  if (removedComponents.length) {
    lines.push(`### Removed components (${removedComponents.length})`);
    removedComponents.slice(0, 10).forEach(c => lines.push(`  - ${c}`));
    lines.push("");
  }
  if (newTokens.length) {
    lines.push(`### New design tokens (${newTokens.length})`);
    newTokens.slice(0, 10).forEach(t => lines.push(`  + ${t}`));
    lines.push("");
  }
  if (removedTokens.length) {
    lines.push(`### Removed design tokens (${removedTokens.length})`);
    removedTokens.slice(0, 10).forEach(t => lines.push(`  - ${t}`));
    lines.push("");
  }

  lines.push("### Suggested action");
  if (newComponents.length) {
    const newCaps = newComponents.slice(0, 5).map(c => `View${c}`).join(", ");
    lines.push(`Consider adding these capabilities: ${newCaps}`);
    lines.push(`Call infernoflow_run with task "add UI capabilities for new components: ${newComponents.slice(0,3).join(", ")}" to update the contract.`);
  }

  return lines.join("\n");
}

// ── infernoflow_review ─────────────────────────────────────────────────────
function reviewDrift(baseBranch) {
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const contractPath = path.join(infernoDir, "contract.json");
  if (!fs.existsSync(contractPath)) return "inferno/ not found — run infernoflow init first";

  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

  // Get changed files vs base branch
  const runGit = (cmd) => { try { return execSync(cmd, { cwd, encoding: "utf8", timeout: 15_000 }); } catch { return ""; } };

  const diffOutput = runGit(`git diff --name-only ${baseBranch}...HEAD`);
  const changedFiles = diffOutput.split("\n").map(l => l.trim()).filter(Boolean);

  if (!changedFiles.length) return `No changes detected vs ${baseBranch}. Safe to merge.`;

  // Categorise changed files
  const infraFiles = changedFiles.filter(f => /\.(json|yaml|yml|env|config|lock)$/.test(f) || f.includes("inferno/"));
  const sourceFiles = changedFiles.filter(f => /\.(ts|tsx|js|jsx|mjs|cs|py|go|java)$/.test(f));
  const styleFiles = changedFiles.filter(f => /\.(css|scss|sass|less)$/.test(f));
  const contractChanged = changedFiles.some(f => f.startsWith("inferno/"));

  // Keyword-based drift detection on changed source files
  const HEURISTICS = [
    { kw: ["search"], id: "SearchItems" }, { kw: ["filter"], id: "FilterItems" },
    { kw: ["auth", "login", "logout"], id: "Authentication" },
    { kw: ["create", "add", "new"], id: "CreateItem" },
    { kw: ["update", "edit", "patch"], id: "UpdateItem" },
    { kw: ["delete", "remove"], id: "DeleteItem" },
    { kw: ["list", "read", "fetch", "get"], id: "ReadItems" },
    { kw: ["due", "deadline"], id: "SetDueDate" },
    { kw: ["priority"], id: "SetPriority" },
    { kw: ["complete", "toggle"], id: "ToggleComplete" },
    { kw: ["export", "download"], id: "ExportData" },
    { kw: ["import", "upload"], id: "ImportData" },
    { kw: ["notify", "notification", "email"], id: "SendNotification" },
    { kw: ["payment", "checkout", "stripe"], id: "ProcessPayment" },
  ];

  const capHits = new Map();
  const registeredCaps = new Set(contract.capabilities || []);

  for (const file of sourceFiles) {
    const lower = file.toLowerCase();
    for (const rule of HEURISTICS) {
      if (rule.kw.some(k => lower.includes(k))) {
        if (!capHits.has(rule.id)) capHits.set(rule.id, []);
        capHits.get(rule.id).push(file);
      }
    }
  }

  const newCapSignals = [...capHits.entries()].filter(([id]) => !registeredCaps.has(id));
  const existingCapSignals = [...capHits.entries()].filter(([id]) => registeredCaps.has(id));

  const lines = [
    `## infernoflow PR review — drift check vs \`${baseBranch}\``,
    `Changed files: ${changedFiles.length} | Source: ${sourceFiles.length} | Styles: ${styleFiles.length} | Infra: ${infraFiles.length}`,
    "",
  ];

  // Risk assessment
  let riskLevel = "LOW";
  if (newCapSignals.length > 0) riskLevel = "MEDIUM";
  if (newCapSignals.length >= 3 || (newCapSignals.length >= 1 && !contractChanged)) riskLevel = "HIGH";

  const riskEmoji = riskLevel === "HIGH" ? "🔴" : riskLevel === "MEDIUM" ? "🟡" : "🟢";
  lines.push(`### ${riskEmoji} Drift risk: ${riskLevel}`);
  lines.push("");

  if (contractChanged) {
    lines.push("✔ inferno/ contract files were updated in this PR — good practice.");
    lines.push("");
  } else if (sourceFiles.length > 0) {
    lines.push("⚠ Source files changed but inferno/ contract was NOT updated.");
    lines.push("  Consider running: infernoflow_run to check if capabilities need updating.");
    lines.push("");
  }

  if (newCapSignals.length > 0) {
    lines.push(`### Possible new capabilities (not in contract):`);
    for (const [id, files] of newCapSignals.slice(0, 6)) {
      lines.push(`  - **${id}** — suggested by: ${files.slice(0,2).join(", ")}`);
    }
    lines.push("");
    lines.push(`Suggested action: call infernoflow_run with task "review new capabilities: ${newCapSignals.slice(0,3).map(([id])=>id).join(', ')}"`);
    lines.push("");
  }

  if (existingCapSignals.length > 0) {
    lines.push(`### Existing capabilities touched:`);
    for (const [id, files] of existingCapSignals.slice(0, 6)) {
      lines.push(`  - **${id}** — ${files.slice(0,2).join(", ")}`);
    }
    lines.push("");
  }

  if (styleFiles.length > 0) {
    lines.push(`### Style changes (${styleFiles.length} files) — run infernoflow_scan_ui to check UI contract`);
    styleFiles.slice(0, 5).forEach(f => lines.push(`  - ${f}`));
    lines.push("");
  }

  if (riskLevel === "LOW" && !newCapSignals.length) {
    lines.push("✔ No new capability signals detected. Safe to merge (run infernoflow_check as final gate).");
  }

  return lines.join("\n");
}

function buildImplementPrompt(task, mode) {
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const contractPath = path.join(infernoDir, "contract.json");
  const capsPath = path.join(infernoDir, "capabilities.json");
  const profilePath = path.join(infernoDir, "developer-profile.json");

  if (!fs.existsSync(contractPath)) return "inferno/ not found — run infernoflow init first";

  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const caps = fs.existsSync(capsPath) ? JSON.parse(fs.readFileSync(capsPath, "utf8")) : {};
  const profile = fs.existsSync(profilePath) ? JSON.parse(fs.readFileSync(profilePath, "utf8")) : {};

  const capList = (caps.capabilities || []).map(c => `  - ${c.id}: ${c.title || c.id}`).join("\n");
  const stack = profile.stack || {};
  const stackLine = [stack.framework, stack.language, stack.projectType].filter(Boolean).join(" / ") || "unknown";
  const namingStyle = profile.namingStyle || "PascalCase";

  const cursorPrompt = `## Cursor Agent Implementation Prompt
Task: "${task}"
Project: ${contract.policyId} (${stackLine})
Naming convention: ${namingStyle}

### Current capabilities
${capList || "  (none registered)"}

### Implementation instructions
1. Implement "${task}" following the existing code patterns in this project
2. Use ${namingStyle} for any new identifiers, matching the existing capability naming
3. Keep changes minimal — only touch files relevant to this task
4. After implementing, call \`infernoflow_run\` with task "${task}" to update the contract
5. Then call \`infernoflow_check\` to validate everything is in sync

### Definition of done
- Feature works as described
- Contract updated via infernoflow_run → infernoflow_apply
- infernoflow_check passes`;

  const genericPrompt = `## Implementation Prompt
Task: "${task}"
Project: ${contract.policyId}
Stack: ${stackLine}
Capabilities already in contract: ${(contract.capabilities || []).join(", ")}

Implement the task above. When done, run:
  infernoflow suggest "${task}"
  infernoflow check`;

  if (mode === "cursor") return cursorPrompt;
  if (mode === "generic") return genericPrompt;
  return cursorPrompt + "\n\n---\n\n" + genericPrompt;
}

function buildPrompt(task) {
  const infernoDir = path.join(process.cwd(), "inferno");
  const contractPath = path.join(infernoDir, "contract.json");
  const capsPath = path.join(infernoDir, "capabilities.json");
  if (!fs.existsSync(contractPath)) return null;
  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const caps = fs.existsSync(capsPath) ? JSON.parse(fs.readFileSync(capsPath, "utf8")) : {};
  const capList = (caps.capabilities || []).map(c => `  - ${c.id}: ${c.title || c.id}`).join("\n");
  return `You are a developer assistant for the infernoflow CLI tool.
Analyze this task and suggest updates to the infernoflow contract files.

## Current contract
policyId: ${contract.policyId}
policyVersion: ${contract.policyVersion}
capabilities: [${(contract.capabilities || []).join(", ")}]

## Capabilities registry
${capList || "  (none)"}

## Task
"${task}"

## Instructions
Respond with ONLY a valid JSON object:
{
  "summary": "one-line summary of what changed",
  "newCapabilities": [{ "id": "PascalCase", "title": "Human readable title", "reason": "why this is new" }],
  "removedCapabilities": [],
  "updatedScenarios": [],
  "changelogEntry": "- Short description for CHANGELOG.md"
}`;
}

function handleTool(id, name, input) {
  try {
    let text = "";
    if (name === "infernoflow_run") {
      const prompt = buildPrompt(input.task);
      if (!prompt) { sendError(id, -32000, "inferno/ not found — run infernoflow init first"); return; }
      const promptFile = path.join(process.cwd(), "inferno", "agent-prompt.md");
      fs.writeFileSync(promptFile, prompt, "utf8");
      text = `## infernoflow task: "${input.task}"\n\n${prompt}\n\n---\nRespond with the JSON, then call **infernoflow_apply** with your JSON string.`;
    } else if (name === "infernoflow_apply") {
      const responseFile = path.join(process.cwd(), "inferno", "agent-response.json");
      let json = input.json.trim().replace(/^```json?\n?/, "").replace(/\n?```$/, "");
      fs.writeFileSync(responseFile, json, "utf8");
      text = runCmd(`run "apply"`, { INFERNO_AGENT_RESPONSE_FILE: responseFile, INFERNO_AGENT_AVAILABLE: "1" });
    } else if (name === "infernoflow_check") {
      text = runCmd("check");
    } else if (name === "infernoflow_status") {
      text = runCmd("status");
    } else if (name === "infernoflow_context") {
      const parts = [];
      if (input.intent) parts.push(`--intent "${input.intent}"`);
      if (input.working) parts.push(`--working "${input.working}"`);
      text = runCmd("context " + parts.join(" "));
    } else if (name === "infernoflow_git_drift") {
      text = detectGitDrift(input.sinceCommits || 1);
    } else if (name === "infernoflow_implement") {
      text = buildImplementPrompt(input.task, input.mode || "both");
    } else if (name === "infernoflow_scan_ui") {
      text = scanUi();
    } else if (name === "infernoflow_review") {
      text = reviewDrift(input.branch || "main");

    // ── AMP-spec aliases ───────────────────────────────────────────────────
    } else if (name === "amp_read") {
      const args = [];
      if (input.query) args.push(JSON.stringify(input.query));
      if (input.type)  args.push("--type", input.type);
      if (input.limit) args.push("--limit", String(input.limit));
      text = runCmd("ask " + args.join(" "));
    } else if (name === "amp_write") {
      const t = (input.type || "note").replace(/[^a-z]/g, "");
      const m = JSON.stringify(input.msg || "");
      const extras = [];
      if (input.file) extras.push("--source", JSON.stringify(input.file));
      text = runCmd(`log ${m} --type ${t} ${extras.join(" ")}`);
    } else if (name === "amp_handoff") {
      // switch writes a file; we read it back to return the content
      const switchResult = runCmd("switch");
      if (isCmdError(switchResult)) {
        return sendError(id, -32000, `infernoflow switch failed: ${switchResult.message}\n${switchResult.stderr || switchResult.stdout || ""}`.trim());
      }
      try {
        const ampPath    = path.join(process.cwd(), ".ai-memory", "handoff.md");
        const legacyPath = path.join(process.cwd(), "inferno",    "HANDOFF.md");
        const target = fs.existsSync(ampPath) ? ampPath : legacyPath;
        text = fs.readFileSync(target, "utf8");
        if (input.format === "json") {
          // very small markdown-to-json — caller can re-parse if needed
          text = JSON.stringify({ handoff: text });
        }
      } catch (err) {
        text = "(handoff generated; could not read back: " + err.message + ")";
      }
    } else if (name === "amp_search") {
      const args = [JSON.stringify(input.query || "")];
      if (input.type) args.push("--type", input.type);
      text = runCmd("ask " + args.join(" "));
    } else if (name === "amp_health") {
      const recap = runCmd("recap --json");
      if (isCmdError(recap)) {
        text = runCmd("status");
      } else {
        text = recap.trim() || runCmd("status");
      }

    } else { return sendError(id, -32601, `Unknown tool: ${name}`); }

    // Central error check — if any runCmd() call produced a structured error,
    // surface it as a real JSON-RPC error so the calling AI sees a proper
    // failure instead of garbled stderr text mixed into a "successful" reply.
    if (isCmdError(text)) {
      const detail = (text.stderr || text.stdout || "").trim();
      const fullMsg = detail
        ? `infernoflow CLI failed: ${text.message}\n${detail}`
        : `infernoflow CLI failed: ${text.message}`;
      return sendError(id, -32000, fullMsg);
    }
    sendResult(id, { content: [{ type: "text", text: text || "(no output)" }] });
  } catch (err) { sendError(id, -32000, err.message); }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === "initialize") { sendResult(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "infernoflow", version: "1.0.0" } }); return; }
  if (method === "tools/list") { sendResult(id, { tools: TOOLS }); return; }
  if (method === "tools/call") { handleTool(id, params.name, params.arguments || {}); return; }
  if (id !== undefined) sendError(id, -32601, `Method not found: ${method}`);
});
process.stderr.write("[infernoflow MCP] started\n");
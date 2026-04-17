import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function sendResult(id, result) { send({ jsonrpc: "2.0", id, result }); }
function sendError(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

function runCmd(args, env = {}) {
  try { return execSync(`npx infernoflow ${args}`, { encoding: "utf8", cwd: process.cwd(), timeout: 30000, env: { ...process.env, ...env } }); }
  catch (err) { return err.stdout || err.message; }
}

const TOOLS = [
  { name: "infernoflow_run", description: "Generate an infernoflow task prompt. Returns the prompt — respond to it with JSON, then call infernoflow_apply.", inputSchema: { type: "object", properties: { task: { type: "string", description: "What to build" } }, required: ["task"] } },
  { name: "infernoflow_apply", description: "Apply an infernoflow suggestion JSON returned by the agent. Call this after responding to infernoflow_run.", inputSchema: { type: "object", properties: { json: { type: "string", description: "The JSON suggestion from the agent" } }, required: ["json"] } },
  { name: "infernoflow_check", description: "Validate infernoflow contract and capabilities", inputSchema: { type: "object", properties: {} } },
  { name: "infernoflow_status", description: "Show contract health at a glance", inputSchema: { type: "object", properties: {} } },
  { name: "infernoflow_context", description: "Generate AI-ready context", inputSchema: { type: "object", properties: { intent: { type: "string" }, working: { type: "string" } } } },
];

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
    } else { return sendError(id, -32601, `Unknown tool: ${name}`); }
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
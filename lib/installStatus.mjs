/**
 * What infernoflow has wired up in a project, read from the files themselves
 * (0.49.0). `setup` used to print only what changed in its last pass, so a
 * first run (init in a child process, then a second pass with nothing left to
 * change) listed 3 items although everything was installed. This reports the
 * real state, with the reason for anything skipped and how to fix it.
 */
import * as fs   from "node:fs";
import * as path from "node:path";
import { claudeDesktopConfigPath, codexInUse, readCodexEntry } from "./mcpRegistration.mjs";
import { hooksDir, PRECOMMIT_START } from "./gitHooks.mjs";
import { GITIGNORE_START } from "./cleanTree.mjs";

const SECTION_START = "<!-- infernoflow:start -->";
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const json = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const hasBlock = (p) => (read(p) || "").includes(SECTION_START);

/**
 * @returns {Array<{ key: string, label: string, state: "ok" | "missing" | "skipped", where?: string, note?: string }>}
 */
export function installStatus(projectDir) {
  const p = (...a) => path.join(projectDir, ...a);
  const out = [];
  const add = (key, label, state, where, note) => out.push({ key, label, state, where, note });

  add("memory", "Memory store", fs.existsSync(p(".ai-memory")) ? "ok" : "missing", ".ai-memory/",
    fs.existsSync(p(".ai-memory")) ? undefined : "run: infernoflow init --yes");

  // Claude Code: MCP + hooks (memory at session start, prompt hook) + skill + agent.
  const mcp = json(p(".mcp.json"));
  const settings = json(p(".claude", "settings.json")) || {};
  const hookText = JSON.stringify(settings.hooks || {});
  const claudeParts = {
    ".mcp.json": !!(mcp && mcp.mcpServers && mcp.mcpServers.infernoflow),
    "session hooks": hookText.includes("infernoflow-session"),
    "prompt hook": hookText.includes("log-frustration"),
    "skill": fs.existsSync(p(".claude", "skills", "infernoflow-memory", "SKILL.md")),
    "memory-keeper agent": fs.existsSync(p(".claude", "agents", "memory-keeper.md")),
  };
  const claudeMissing = Object.entries(claudeParts).filter(([, v]) => !v).map(([k]) => k);
  add("claude", "Claude Code", claudeMissing.length ? "missing" : "ok", Object.keys(claudeParts).join(", "),
    claudeMissing.length ? `missing: ${claudeMissing.join(", ")} — run: infernoflow setup --yes` : undefined);

  const cursorOk = !!(json(p(".cursor", "mcp.json")) || {}).mcpServers?.infernoflow && hasBlock(p(".cursorrules"));
  add("cursor", "Cursor", cursorOk ? "ok" : "missing", ".cursor/mcp.json, .cursorrules", cursorOk ? undefined : "run: infernoflow setup --yes");

  const vsOk = !!(json(p(".vscode", "mcp.json")) || {}).servers?.infernoflow && hasBlock(p(".github", "copilot-instructions.md"));
  add("vscode", "VS Code Copilot", vsOk ? "ok" : "missing", ".vscode/mcp.json, .github/copilot-instructions.md", vsOk ? undefined : "run: infernoflow setup --yes");

  if (readCodexEntry(projectDir)) {
    const agents = hasBlock(p("AGENTS.md"));
    add("codex", "Codex", agents ? "ok" : "missing", ".codex/config.toml, AGENTS.md", agents ? "trust the project in Codex once so it loads this" : "AGENTS.md has no memory block — run: infernoflow refresh --targets AGENTS.md,.cursorrules,.github/copilot-instructions.md");
  } else if (codexInUse(projectDir)) {
    add("codex", "Codex", "missing", ".codex/config.toml", "run: infernoflow setup --yes");
  } else {
    add("codex", "Codex", "skipped", undefined, "Codex isn't installed on this machine");
  }

  const desktopFile = claudeDesktopConfigPath();
  if (!fs.existsSync(path.dirname(desktopFile)) && !fs.existsSync(desktopFile)) {
    add("desktop", "Claude Desktop", "skipped", undefined, "the Claude Desktop app isn't installed on this machine");
  } else {
    const servers = (json(desktopFile) || {}).mcpServers || {};
    const mine = Object.entries(servers).find(([k, v]) => k.startsWith("infernoflow") && v && v.env &&
      typeof v.env.INFERNOFLOW_PROJECT_DIR === "string" && path.resolve(v.env.INFERNOFLOW_PROJECT_DIR) === path.resolve(projectDir));
    add("desktop", "Claude Desktop", mine ? "ok" : "missing", mine ? `claude_desktop_config.json (${mine[0]})` : "claude_desktop_config.json",
      mine ? undefined : "run: infernoflow setup --yes");
  }

  const hd = hooksDir(projectDir);
  if (hd.skipped === "not-a-repo") {
    add("precommit", "Git pre-commit note", "skipped", undefined, "not a git repository — run `git init`, then `infernoflow setup --yes` again");
  } else if (hd.skipped === "hooksPath") {
    add("precommit", "Git pre-commit note", "skipped", undefined, "git uses a custom hooks folder (core.hooksPath) — add: infernoflow hook pre-commit || true");
  } else {
    const ok = (read(path.join(hd.dir, "pre-commit")) || "").includes(PRECOMMIT_START);
    add("precommit", "Git pre-commit note", ok ? "ok" : "missing", ".git/hooks/pre-commit", ok ? undefined : "run: infernoflow setup --yes");
  }

  const policy = (read(p(".gitignore")) || "").includes(GITIGNORE_START) && (read(p(".gitattributes")) || "").includes(GITIGNORE_START);
  add("gitpolicy", "Git policy", policy ? "ok" : "missing", ".gitignore, .gitattributes", policy ? undefined : "run: infernoflow init --yes");

  return out;
}

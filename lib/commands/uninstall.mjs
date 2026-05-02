/**
 * infernoflow uninstall
 *
 * Removes everything infernoflow installed from a project.
 * The inverse of `infernoflow setup`.
 *
 * What it removes:
 *   - inferno/                              — contract, capabilities, session memory, HANDOFF.md
 *   - CLAUDE.md                             — auto-behavior instruction file
 *   - .claude/settings.json                 — pre-approved tools (infernoflow entries only)
 *   - .cursor/inferno-mcp-server.mjs        — MCP server file
 *   - .cursor/hooks.json                    — cursor hooks config (if infernoflow-only)
 *   - .cursor/hooks/inferno-session-draft.mjs — cursor hook script
 *   - .cursor/mcp.json                      — infernoflow entry (other entries preserved)
 *   - inferno-mcp-server.mjs                — root-level MCP server copy
 *   - ~/.claude.json                        — infernoflow mcpServers entry (other entries preserved)
 *   - .git/hooks/post-commit / pre-push     — infernoflow sections (other hooks preserved)
 *
 * Flags:
 *   --dry-run         Preview what would be removed without touching anything
 *   --keep-memory     Preserve inferno/sessions.jsonl (your session logs)
 *   --keep-inferno    Preserve the entire inferno/ folder
 *   --yes / -y        Skip confirmation prompt
 *   --json            Machine-readable output
 *
 * Usage:
 *   infernoflow uninstall               Interactive — shows plan, asks to confirm
 *   infernoflow uninstall --dry-run     Show what would be removed
 *   infernoflow uninstall --yes         Remove without prompting
 *   infernoflow uninstall --keep-memory Remove setup but keep session logs
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import * as os   from "node:os";
import * as readline from "node:readline";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

const INFERNO_DIR      = "inferno";
const CLAUDE_MD        = "CLAUDE.md";
const CLAUDE_DIR       = ".claude";
const CURSOR_DIR       = ".cursor";
const MCP_SERVER       = path.join(CURSOR_DIR, "inferno-mcp-server.mjs");
const MCP_SERVER_ROOT  = "inferno-mcp-server.mjs";  // root-level copy from install-cursor-hooks
const CURSOR_HOOKS_JSON= path.join(CURSOR_DIR, "hooks.json");
const CURSOR_HOOK_FILE = path.join(CURSOR_DIR, "hooks", "inferno-session-draft.mjs");
const CURSOR_MCP       = path.join(CURSOR_DIR, "mcp.json");
const CLAUDE_JSON      = path.join(os.homedir(), ".claude.json");
const GIT_HOOKS        = [".git/hooks/post-commit", ".git/hooks/pre-push"];
const INFERNO_MARKER   = "# infernoflow";

// ── helpers ──────────────────────────────────────────────────────────────────

function exists(p) { return fs.existsSync(p); }
function readJSON(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }

function readFile(f) {
  try { return fs.readFileSync(f, "utf8"); } catch { return null; }
}

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans); });
  });
}

// ── planners — compute what would be removed ─────────────────────────────────

function planInfernoDir(cwd, keepMemory, keepInferno) {
  const items = [];
  const dir = path.join(cwd, INFERNO_DIR);
  if (!exists(dir)) return items;

  if (keepInferno) {
    items.push({ type: "skip", path: INFERNO_DIR, reason: "--keep-inferno" });
    return items;
  }

  if (keepMemory) {
    // Remove everything except sessions.jsonl
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f === "sessions.jsonl") {
        items.push({ type: "skip", path: path.join(INFERNO_DIR, f), reason: "--keep-memory" });
      } else {
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          items.push({ type: "rmdir", path: path.join(INFERNO_DIR, f) });
        } else {
          items.push({ type: "rm", path: path.join(INFERNO_DIR, f) });
        }
      }
    }
  } else {
    items.push({ type: "rmdir", path: INFERNO_DIR });
  }

  return items;
}

function planClaudeMd(cwd) {
  const p = path.join(cwd, CLAUDE_MD);
  if (!exists(p)) return [];
  return [{ type: "rm", path: CLAUDE_MD }];
}

function planClaudeDir(cwd) {
  const items = [];
  const settingsFile = path.join(cwd, CLAUDE_DIR, "settings.json");
  if (!exists(settingsFile)) return items;

  const settings = readJSON(settingsFile);
  const hasInfernoTools = settings?.tools?.some?.(t => t.startsWith?.("mcp__infernoflow"));
  const hasOtherContent = settings && Object.keys(settings).some(k => {
    if (k === "tools") {
      return (settings.tools || []).some(t => !t.startsWith("mcp__infernoflow"));
    }
    return k !== "tools";
  });

  if (hasInfernoTools && !hasOtherContent) {
    items.push({ type: "rm", path: path.join(CLAUDE_DIR, "settings.json"), desc: "auto-approved tools" });
  } else if (hasInfernoTools) {
    items.push({ type: "edit", path: path.join(CLAUDE_DIR, "settings.json"), desc: "remove infernoflow tools (preserve other content)" });
  }
  return items;
}

function planCursorMcpServer(cwd) {
  const items = [];
  // .cursor/inferno-mcp-server.mjs
  if (exists(path.join(cwd, MCP_SERVER))) items.push({ type: "rm", path: MCP_SERVER });
  // root-level inferno-mcp-server.mjs (written by install-cursor-hooks)
  if (exists(path.join(cwd, MCP_SERVER_ROOT))) items.push({ type: "rm", path: MCP_SERVER_ROOT });
  // .cursor/hooks/inferno-session-draft.mjs
  if (exists(path.join(cwd, CURSOR_HOOK_FILE))) items.push({ type: "rm", path: CURSOR_HOOK_FILE });
  // .cursor/hooks.json — only remove if it only contains the infernoflow hook
  const hooksJsonPath = path.join(cwd, CURSOR_HOOKS_JSON);
  if (exists(hooksJsonPath)) {
    const cfg = readJSON(hooksJsonPath);
    // cfg.hooks may be missing, an array, or an object map keyed by hook event.
    // Normalise to a flat list of hook entries before .every().
    const rawHooks = cfg?.hooks;
    const hooks = Array.isArray(rawHooks)
      ? rawHooks
      : rawHooks && typeof rawHooks === "object"
        ? Object.values(rawHooks).flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean)
        : [];
    const hasOnlyInferno = hooks.length > 0 && hooks.every(h => (h?.name || h?.command || "").includes("inferno"));
    if (hasOnlyInferno) {
      items.push({ type: "rm", path: CURSOR_HOOKS_JSON, desc: "infernoflow-only hooks config" });
    } else {
      items.push({ type: "edit", path: CURSOR_HOOKS_JSON, desc: "remove infernoflow hook entry (preserve others)" });
    }
  }
  return items;
}

function planCursorMcpJson(cwd) {
  const p = path.join(cwd, CURSOR_MCP);
  if (!exists(p)) return [];
  const cfg = readJSON(p);
  if (!cfg?.mcpServers?.infernoflow) return [];
  const otherKeys = Object.keys(cfg.mcpServers || {}).filter(k => k !== "infernoflow");
  if (otherKeys.length === 0 && Object.keys(cfg).length === 1) {
    return [{ type: "rm", path: CURSOR_MCP, desc: "infernoflow-only file" }];
  }
  return [{ type: "edit", path: CURSOR_MCP, desc: 'remove "infernoflow" key (preserve other servers)' }];
}

function planClaudeJson() {
  if (!exists(CLAUDE_JSON)) return [];
  const cfg = readJSON(CLAUDE_JSON);
  if (!cfg?.mcpServers?.infernoflow) return [];
  return [{ type: "edit", path: "~/.claude.json", desc: 'remove "infernoflow" MCP entry (preserve other entries)', _realPath: CLAUDE_JSON }];
}

function planGitHooks(cwd) {
  const items = [];
  for (const hookRel of GIT_HOOKS) {
    const hookPath = path.join(cwd, hookRel);
    if (!exists(hookPath)) continue;
    const content = readFile(hookPath);
    if (!content?.includes(INFERNO_MARKER)) continue;

    const lines = content.split("\n");
    const markerIdx = lines.findIndex(l => l.includes(INFERNO_MARKER));
    const beforeMarker = lines.slice(0, markerIdx).join("\n").trim();

    if (!beforeMarker || beforeMarker === "#!/bin/sh" || beforeMarker === "#!/bin/bash") {
      items.push({ type: "rm", path: hookRel, desc: "infernoflow-only hook" });
    } else {
      items.push({ type: "edit", path: hookRel, desc: "remove infernoflow section (preserve existing hooks)" });
    }
  }
  return items;
}

// ── executors ─────────────────────────────────────────────────────────────────

function removeInfernoDir(cwd, plan, dryRun) {
  for (const item of plan) {
    if (item.type === "skip") continue;
    const full = path.join(cwd, item.path);
    if (dryRun) continue;
    try {
      if (item.type === "rmdir") {
        fs.rmSync(full, { recursive: true, force: true });
      } else {
        fs.unlinkSync(full);
      }
    } catch {}
  }
}

function removeClaudeMd(cwd, dryRun) {
  if (dryRun) return;
  try { fs.unlinkSync(path.join(cwd, CLAUDE_MD)); } catch {}
}

function removeClaudeDir(cwd, plan, dryRun) {
  const settingsPath = path.join(cwd, CLAUDE_DIR, "settings.json");
  for (const item of plan) {
    if (dryRun) continue;
    if (item.type === "rm") {
      try { fs.unlinkSync(path.join(cwd, item.path)); } catch {}
    } else if (item.type === "edit") {
      try {
        const cfg = readJSON(settingsPath);
        if (cfg?.tools) {
          cfg.tools = cfg.tools.filter(t => !t.startsWith("mcp__infernoflow"));
        }
        fs.writeFileSync(settingsPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
      } catch {}
    }
  }
}

function removeCursorMcpServer(cwd, plan, dryRun) {
  if (dryRun) return;
  for (const item of plan) {
    if (item.type === "rm") {
      try { fs.unlinkSync(path.join(cwd, item.path)); } catch {}
    } else if (item.type === "edit" && item.path === CURSOR_HOOKS_JSON) {
      try {
        const cfg = readJSON(path.join(cwd, CURSOR_HOOKS_JSON));
        if (cfg?.hooks) {
          cfg.hooks = cfg.hooks.filter(h => !(h.name || h.command || "").includes("inferno"));
        }
        fs.writeFileSync(path.join(cwd, CURSOR_HOOKS_JSON), JSON.stringify(cfg, null, 2) + "\n", "utf8");
      } catch {}
    }
  }
}

function removeCursorMcpJson(cwd, plan, dryRun) {
  const mcpPath = path.join(cwd, CURSOR_MCP);
  for (const item of plan) {
    if (dryRun) continue;
    if (item.type === "rm") {
      try { fs.unlinkSync(mcpPath); } catch {}
    } else if (item.type === "edit") {
      try {
        const cfg = readJSON(mcpPath);
        if (cfg?.mcpServers?.infernoflow) delete cfg.mcpServers.infernoflow;
        fs.writeFileSync(mcpPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");
      } catch {}
    }
  }
}

function removeClaudeJson(plan, dryRun) {
  for (const item of plan) {
    if (dryRun) continue;
    const p = item._realPath || CLAUDE_JSON;
    if (item.type === "edit") {
      try {
        const cfg = readJSON(p);
        if (cfg?.mcpServers?.infernoflow) delete cfg.mcpServers.infernoflow;
        fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", "utf8");
      } catch {}
    }
  }
}

function removeGitHooks(cwd, plan, dryRun) {
  for (const item of plan) {
    const hookPath = path.join(cwd, item.path);
    if (dryRun) continue;
    if (item.type === "rm") {
      try { fs.unlinkSync(hookPath); } catch {}
    } else if (item.type === "edit") {
      try {
        const content = readFile(hookPath);
        const lines = content.split("\n");
        const markerIdx = lines.findIndex(l => l.includes(INFERNO_MARKER));
        const preserved = lines.slice(0, markerIdx).join("\n").trimEnd();
        fs.writeFileSync(hookPath, preserved + "\n", "utf8");
      } catch {}
    }
  }
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function uninstallCommand(args = []) {
  const has       = f => args.includes(f);
  const dryRun    = has("--dry-run") || has("--dry");
  const keepMem   = has("--keep-memory");
  const keepInf   = has("--keep-inferno");
  const skipPrompt= has("--yes") || has("-y");
  const jsonMode  = has("--json");

  const cwd = process.cwd();

  // ── Build the full removal plan ──────────────────────────────────────────
  const plan = {
    infernoDir:      planInfernoDir(cwd, keepMem, keepInf),
    claudeMd:        planClaudeMd(cwd),
    claudeDir:       planClaudeDir(cwd),
    cursorMcpServer: planCursorMcpServer(cwd),
    cursorMcpJson:   planCursorMcpJson(cwd),
    claudeJson:      planClaudeJson(),
    gitHooks:        planGitHooks(cwd),
  };

  const allItems = Object.values(plan).flat();
  const actionItems = allItems.filter(i => i.type !== "skip");

  if (jsonMode) {
    console.log(JSON.stringify({ dryRun, keepMemory: keepMem, keepInferno: keepInf, plan, actionCount: actionItems.length }, null, 2));
    return;
  }

  const SEP = gray("  " + "─".repeat(52));

  console.log();
  console.log("  " + bold("🔥 infernoflow uninstall"));
  if (dryRun) console.log(yellow("  DRY RUN — nothing will be changed"));
  console.log(SEP);

  if (actionItems.length === 0) {
    console.log();
    console.log(green("  ✔ Nothing to remove — infernoflow is not installed in this project"));
    console.log();
    return;
  }

  // ── Print the plan ───────────────────────────────────────────────────────
  console.log();
  console.log("  " + bold("Will remove:"));
  console.log();

  const typeIcon = { rm: red("  ✖"), rmdir: red("  ✖"), edit: yellow("  ~"), skip: gray("  ·") };

  for (const item of allItems) {
    const icon  = typeIcon[item.type] || "  ?";
    const label = item.desc ? gray(` (${item.desc})`) : "";
    console.log(`${icon}  ${item.path}${label}`);
  }

  if (keepMem) {
    console.log();
    console.log(gray("  ℹ  inferno/sessions.jsonl will be preserved (--keep-memory)"));
  }

  console.log();

  // ── Confirm ──────────────────────────────────────────────────────────────
  if (!dryRun && !skipPrompt) {
    const ans = await prompt("  Continue? " + gray("[y/N] ") );
    if (!ans.trim().toLowerCase().startsWith("y")) {
      console.log(gray("\n  Aborted — nothing changed.\n"));
      return;
    }
    console.log();
  }

  if (dryRun) {
    console.log(gray("  ↑ Dry run complete — run without --dry-run to apply\n"));
    return;
  }

  // ── Execute ──────────────────────────────────────────────────────────────
  removeInfernoDir(cwd, plan.infernoDir, false);
  if (plan.claudeMd.length)        removeClaudeMd(cwd, false);
  if (plan.claudeDir.length)       removeClaudeDir(cwd, plan.claudeDir, false);
  if (plan.cursorMcpServer.length) removeCursorMcpServer(cwd, plan.cursorMcpServer, false);
  if (plan.cursorMcpJson.length)   removeCursorMcpJson(cwd, plan.cursorMcpJson, false);
  if (plan.claudeJson.length)      removeClaudeJson(plan.claudeJson, false);
  if (plan.gitHooks.length)        removeGitHooks(cwd, plan.gitHooks, false);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log(SEP);
  console.log();
  console.log(green("  ✔ infernoflow removed from this project"));
  console.log();

  const edited = actionItems.filter(i => i.type === "edit");
  const removed = actionItems.filter(i => i.type === "rm" || i.type === "rmdir");

  if (removed.length) console.log(gray(`  Deleted: `) + removed.map(i => i.path).join(", "));
  if (edited.length)  console.log(gray(`  Edited:  `) + edited.map(i => i.path).join(", "));

  if (keepMem) {
    console.log();
    console.log(gray("  Session memory kept → inferno/sessions.jsonl"));
    console.log(gray("  Re-run infernoflow init to restore the rest."));
  }
  console.log();
}

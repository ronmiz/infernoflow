import * as fs from "node:fs";
import * as path from "node:path";
import { installInfernoDraftTooling } from "./draftToolingInstall.mjs";

/**
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.templatesRoot
 * @param {boolean} opts.force
 * @param {boolean} opts.silent
 * @param {(msg: string) => void} [opts.logOk]
 * @param {(msg: string) => void} [opts.logWarn]
 */
export function installCursorHooksArtifacts(opts) {
  const { cwd, templatesRoot, force, silent } = opts;
  const logOk = opts.logOk || (() => {});
  const logWarn = opts.logWarn || (() => {});

  function copyFile(src, dst) {
    if (fs.existsSync(dst) && !force) {
      if (!silent) logWarn("Skipped (exists): " + path.relative(cwd, dst));
      return false;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    if (!silent) logOk("Created: " + path.relative(cwd, dst));
    return true;
  }

  installInfernoDraftTooling({ cwd, templatesRoot, force, silent, logOk, logWarn });

  const srcHooksJson = path.join(templatesRoot, "cursor", "hooks.json");
  const dstHooksJson = path.join(cwd, ".cursor", "hooks.json");
  const srcHook = path.join(templatesRoot, "cursor", "hooks", "inferno-session-draft.mjs");
  const dstHook = path.join(cwd, ".cursor", "hooks", "inferno-session-draft.mjs");

  copyFile(srcHooksJson, dstHooksJson);
  copyFile(srcHook, dstHook);

  // MCP server
  const srcMcp = path.join(templatesRoot, "cursor", "inferno-mcp-server.mjs");
  const dstMcp = path.join(cwd, "inferno-mcp-server.mjs");
  copyFile(srcMcp, dstMcp);

  // .cursor/mcp.json
  const mcpJsonPath = path.join(cwd, ".cursor", "mcp.json");
  if (!fs.existsSync(mcpJsonPath) || force) {
    let existing = {};
    if (fs.existsSync(mcpJsonPath)) {
      try { existing = JSON.parse(fs.readFileSync(mcpJsonPath, "utf8")); } catch {}
    }
    if (!existing.mcpServers) existing.mcpServers = {};
    existing.mcpServers.infernoflow = { command: "node", args: ["./inferno-mcp-server.mjs"], env: {} };
    fs.mkdirSync(path.dirname(mcpJsonPath), { recursive: true });
    fs.writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2), "utf8");
    if (!silent) logOk("Created: .cursor/mcp.json");
  } else {
    if (!silent) logWarn("Skipped (exists): .cursor/mcp.json");
  }
}

import * as fs from "node:fs";
import * as path from "node:path";
import { installInfernoDraftTooling } from "./draftToolingInstall.mjs";
import { refreshSecuritySensitiveCopies } from "./securityRefresh.mjs";
import { updateIdeMcpJson } from "./mcpRegistration.mjs";

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

  // SECURITY (0.44.20): "Skipped (exists)" above means an old hook / MCP
  // server copy may still be in place. Replace outdated generated copies.
  try {
    const refreshed = refreshSecuritySensitiveCopies(cwd);
    if (refreshed.length && !silent) logOk("Security update: replaced " + refreshed.join(", "));
  } catch { /* best effort */ }

  // .cursor/mcp.json — 0.45.0: run the server from the installed package
  // (`infernoflow mcp`) instead of a copy inside the project.
  try {
    const r = updateIdeMcpJson(cwd, "cursor");
    if (!silent) (r.updated ? logOk : logWarn)((r.updated ? "Updated: " : "Unchanged: ") + ".cursor/mcp.json");
  } catch (err) {
    if (!silent) logWarn(".cursor/mcp.json skipped: " + err.message);
  }
}

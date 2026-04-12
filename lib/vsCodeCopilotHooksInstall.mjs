import * as fs from "node:fs";
import * as path from "node:path";
import { installInfernoDraftTooling } from "./draftToolingInstall.mjs";

/**
 * VS Code + GitHub Copilot agent hooks (Preview). See:
 * https://code.visualstudio.com/docs/copilot/customization/hooks
 *
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.templatesRoot
 * @param {boolean} opts.force
 * @param {boolean} opts.silent
 * @param {(msg: string) => void} [opts.logOk]
 * @param {(msg: string) => void} [opts.logWarn]
 */
export function installVsCodeCopilotHooksArtifacts(opts) {
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

  const srcHooks = path.join(templatesRoot, "github-hooks", "infernoflow-drafts.json");
  const dstHooks = path.join(cwd, ".github", "hooks", "infernoflow-drafts.json");
  const srcHookScript = path.join(templatesRoot, "scripts", "inferno-vscode-copilot-hook.mjs");
  const dstHookScript = path.join(cwd, "scripts", "inferno-vscode-copilot-hook.mjs");

  copyFile(srcHooks, dstHooks);
  copyFile(srcHookScript, dstHookScript);
}

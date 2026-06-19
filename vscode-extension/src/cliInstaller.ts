/**
 * cliInstaller — make the extension self-sufficient.
 *
 * Goal: a user installs the VS Code extension from the Marketplace and gets a
 * fully working setup — no separate `npm install -g infernoflow`, no manual
 * `infernoflow setup` step. The extension detects the CLI on activation and,
 * if missing, offers to install it. After install (or if it was already
 * present) it runs the silent setup once per workspace so MCP servers are
 * registered for whichever AI tool the user works in.
 *
 * Why this exists:
 *   Users (rightly) complained that "install extension → AI doesn't log
 *   anything" — because the rule-file Memory protocol skill block was
 *   present but there was no `amp_write` MCP tool wired up. The CLI's
 *   `setup`/`init` does that wiring; until now the user had to know to run
 *   it. This module makes the wiring automatic.
 */

import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";

const CLI_BIN = "infernoflow";

interface CliProbe {
  installed: boolean;
  version?: string;
  /** Absolute path to the resolved binary, if found. */
  path?: string;
}

/**
 * Is Node.js available on PATH? The MCP server that powers AI auto-capture is
 * a Node process the AI tool spawns, and `npm install -g infernoflow` needs
 * Node too — so if Node is missing, attempting the npm install just dead-ends
 * on ENOENT and tells the user to run a command they can't run. Detect it
 * first so we can guide them to nodejs.org instead.
 */
function probeNode(): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    const child = cp.spawn("node", ["--version"], { shell: true, windowsHide: true });
    child.on("error", () => finish(false));
    child.on("close", code => finish(code === 0));
    setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish(false); }, 4000);
  });
}

/**
 * Cheap detection — runs `infernoflow --version` and times out fast.
 * Works on Windows (looks up via PATHEXT) and on POSIX shells.
 */
function probeCli(): Promise<CliProbe> {
  return new Promise(resolve => {
    let done = false;
    const finish = (result: CliProbe) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    const child = cp.spawn(CLI_BIN, ["--version"], {
      shell: true,
      windowsHide: true,
    });
    let stdout = "";
    child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
    child.on("error", () => finish({ installed: false }));
    child.on("close", code => {
      if (code !== 0) return finish({ installed: false });
      const v = stdout.trim().split(/\s+/).pop() || "";
      finish({ installed: true, version: v });
    });
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish({ installed: false });
    }, 4000);
  });
}

/**
 * Run `npm install -g infernoflow@latest` with a progress notification.
 * Returns true on success. Failures are surfaced as warning toasts; we never
 * throw — the extension must keep working even if install fails (the user
 * can still use the sidebar to read memory; only MCP wiring is missing).
 */
async function installCli(): Promise<boolean> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Installing infernoflow CLI…",
      cancellable: false,
    },
    () => new Promise<boolean>(resolve => {
      const child = cp.spawn("npm", ["install", "-g", "infernoflow@latest"], {
        shell: true,
        windowsHide: true,
      });
      let stderr = "";
      child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
      child.on("error", err => {
        vscode.window.showWarningMessage(
          `infernoflow CLI install failed: ${err.message}. Install manually with: npm install -g infernoflow`,
        );
        resolve(false);
      });
      child.on("close", code => {
        if (code === 0) {
          vscode.window.showInformationMessage("infernoflow CLI installed.");
          resolve(true);
        } else {
          // Common failure: missing permissions on macOS/Linux global npm dir.
          const hint = /EACCES|permission/i.test(stderr)
            ? " (likely a permissions issue — try `sudo npm install -g infernoflow` from a terminal)"
            : "";
          vscode.window.showWarningMessage(
            `infernoflow CLI install exited with code ${code}.${hint}`,
          );
          resolve(false);
        }
      });
    }),
  );
}

/**
 * Run `infernoflow setup --yes` in the workspace root so MCP servers are
 * registered for Cursor / VS Code Copilot / Claude Code in one shot. Quiet
 * progress notification, never throws.
 */
async function runSetup(cwd: string): Promise<void> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: "infernoflow: wiring up MCP servers…",
    },
    () => new Promise<void>(resolve => {
      const child = cp.spawn(CLI_BIN, ["setup", "--yes"], {
        cwd,
        shell: true,
        windowsHide: true,
      });
      child.on("error", () => resolve());
      child.on("close", () => resolve());
      // Cap setup at 30s — if something hangs, don't freeze the extension load
      setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        resolve();
      }, 30_000);
    }),
  );
}

/**
 * Has the extension already run setup in this workspace? We track this in
 * the extension's globalState keyed by workspace path so we don't re-run on
 * every activation. The user can re-trigger via the "infernoflow: Setup"
 * command in the palette at any time.
 */
function setupKey(folder: vscode.WorkspaceFolder): string {
  return `infernoflow.setupCompleted:${folder.uri.fsPath}`;
}

/**
 * Public entry — called once from activate(). Always returns; never throws.
 * Runs in the background so activation stays snappy.
 */
export async function ensureCliAndSetup(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return; // No workspace open — nothing to set up against

  const probe = await probeCli();

  // ── 1. Install CLI if missing ────────────────────────────────────────────
  if (!probe.installed) {
    // The CLI install (npm) AND the MCP server both need Node.js. If it's
    // missing, don't offer an npm install that can only fail — be upfront that
    // auto-capture needs Node, point them at the installer, and stop. The
    // sidebar still works (it runs on VS Code's own runtime via infernoflow-amp).
    const hasNode = await probeNode();
    if (!hasNode) {
      const INSTALL = "Install Node.js";
      const pick = await vscode.window.showWarningMessage(
        "infernoflow's AI auto-capture needs Node.js — it runs the memory (MCP) server your AI logs through. " +
        "The sidebar works without it, but the AI can't log gotchas automatically until Node.js is installed, then reload VS Code.",
        INSTALL,
        "Not now",
      );
      if (pick === INSTALL) {
        void vscode.env.openExternal(vscode.Uri.parse("https://nodejs.org/en/download"));
      }
      return;
    }

    const choice = await vscode.window.showInformationMessage(
      "infernoflow CLI is not installed. Install it now so the AI can auto-capture gotchas via the `amp_write` MCP tool?",
      "Install",
      "Not now",
    );
    if (choice !== "Install") return;
    const ok = await installCli();
    if (!ok) return;
  }

  // ── 2. Run silent setup per-workspace, once ──────────────────────────────
  const key = setupKey(folder);
  const already = context.globalState.get<boolean>(key, false);
  const ampDir  = path.join(folder.uri.fsPath, ".ai-memory");
  const cursorMcp = path.join(folder.uri.fsPath, ".cursor", "mcp.json");
  const vscodeMcp = path.join(folder.uri.fsPath, ".vscode", "mcp.json");

  // Re-run if any required artifact is missing — handles "user deleted .cursor/"
  const needsSetup =
    !already ||
    !fs.existsSync(ampDir) ||
    !fs.existsSync(cursorMcp) ||
    !fs.existsSync(vscodeMcp);

  if (needsSetup) {
    await runSetup(folder.uri.fsPath);
    await context.globalState.update(key, true);

    // Auto-capture link 4: the AI tool loads MCP servers at startup and won't
    // see the freshly-registered infernoflow server until it's restarted. This
    // is the single most common "why isn't the AI logging anything?" cause, and
    // it's otherwise invisible — so say it explicitly, once, right after wiring.
    void vscode.window.showInformationMessage(
      "infernoflow auto-capture is wired. Restart your AI tool (Cursor / Claude / Copilot Chat) once so it picks up the memory server.",
    );
  }
}

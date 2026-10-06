/**
 * Run the infernoflow CLI from the extension WITHOUT a shell (0.46.0).
 * `infernoflow.cliPath` is machine-scoped (a workspace can't set it). On
 * Windows the npm launcher is a .cmd file, which Node won't start without a
 * shell — so we locate the CLI's JavaScript entry point and run it with `node`.
 */
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

function findMjs(launcher: string): string | null {
  if (/\.m?js$/i.test(launcher) && fs.existsSync(launcher)) return launcher;
  let hits: string[] = [];
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    hits = cp.execFileSync(finder, [launcher], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 3000 })
      .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch { /* not on PATH */ }
  if (path.isAbsolute(launcher) && fs.existsSync(launcher)) hits.unshift(launcher);
  // `where` (Windows) also searches the CURRENT folder first — never take a
  // launcher from inside an opened workspace (a cloned repo could plant one).
  const roots = (vscode.workspace.workspaceFolders || []).map(f => path.resolve(f.uri.fsPath).toLowerCase());
  const insideWorkspace = (p: string) => { const r = path.resolve(p).toLowerCase(); return roots.some(w => r === w || r.startsWith(w + path.sep)); };
  for (const c of hits) {
    if (insideWorkspace(c)) continue;
    try { const real = fs.realpathSync(c); if (/\.m?js$/i.test(real) && !insideWorkspace(real)) return real; } catch { /* */ }
    const d = path.dirname(c);
    for (const pkg of [path.join(d, "node_modules", "infernoflow"), path.join(d, "..", "lib", "node_modules", "infernoflow")]) {
      for (const f of [path.join(pkg, "dist", "bin", "infernoflow.mjs"), path.join(pkg, "bin", "infernoflow.mjs")]) {
        if (fs.existsSync(f)) return f;
      }
    }
  }
  return null;
}

function cliMjs(): string | null {
  const setting = vscode.workspace.getConfiguration("infernoflow").get<string>("cliPath", "infernoflow") || "infernoflow";
  return findMjs(setting);
}

/** spawn (async) the CLI with an argument array and no shell. Null if untrusted / not found. */
export function spawnCli(args: string[], opts: cp.SpawnOptions = {}): cp.ChildProcess | null {
  if (!vscode.workspace.isTrusted) return null;
  const mjs = cliMjs();
  if (!mjs) return null;
  return cp.spawn("node", [mjs, ...args], { ...opts, shell: false, windowsHide: true });
}

/** spawnSync the CLI with an argument array and no shell. Returns null if untrusted / the CLI can't be found. */
export function runCliSync(args: string[], opts: cp.SpawnSyncOptions = {}): cp.SpawnSyncReturns<string> | null {
  if (!vscode.workspace.isTrusted) return null;   // Restricted Mode: never run the CLI
  const setting = vscode.workspace.getConfiguration("infernoflow").get<string>("cliPath", "infernoflow") || "infernoflow";
  const mjs = findMjs(setting);
  if (!mjs) return null;
  return cp.spawnSync("node", [mjs, ...args], { ...opts, encoding: "utf8", shell: false, windowsHide: true }) as cp.SpawnSyncReturns<string>;
}

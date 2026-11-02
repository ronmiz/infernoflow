/**
 * 0.48.0 — Codex CLI: portable [mcp_servers.infernoflow] in .codex/config.toml,
 * AGENTS.md for instructions, and uninstall that only removes what is ours.
 * Checked against codex-cli 0.166.0: project config loads once the project is
 * trusted, MCP servers start in the project folder, ${workspaceFolder} is not
 * expanded (so the entry carries no env at all).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { updateCodexConfig, readCodexEntry, removeCodexEntry, codexInUse } from "../lib/mcpRegistration.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const read = (f) => fs.readFileSync(f, "utf8");

let savedCodexHome;
beforeEach(() => { savedCodexHome = process.env.CODEX_HOME; });
afterEach(() => { if (savedCodexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = savedCodexHome; });

describe("updateCodexConfig", () => {
  it("creates the file only when asked and Codex is used here", () => {
    const dir = tmp("ifx-cx-");
    process.env.CODEX_HOME = path.join(tmp("ifx-cxh-"), "missing");
    expect(codexInUse(dir)).toBe(false);
    expect(updateCodexConfig(dir, { create: true }).skipped).toBe("no-codex");
    expect(fs.existsSync(path.join(dir, ".codex"))).toBe(false);
    process.env.CODEX_HOME = tmp("ifx-cxh-");
    expect(updateCodexConfig(dir).skipped).toBe("no-codex");           // the upgrade path never creates
    const r = updateCodexConfig(dir, { create: true });
    expect(r).toMatchObject({ updated: true, created: true });
    expect(read(path.join(dir, ".codex", "config.toml"))).toBe('[mcp_servers.infernoflow]\ncommand = "infernoflow"\nargs = ["mcp"]\n');
    expect(updateCodexConfig(dir, { create: true }).updated).toBe(false);   // idempotent
  });

  it("replaces an entry with machine paths and keeps everything else byte for byte (CRLF too)", () => {
    const dir = tmp("ifx-cx-");
    fs.mkdirSync(path.join(dir, ".codex"));
    const f = path.join(dir, ".codex", "config.toml");
    const before = [
      'model = "o3"', "",
      "[mcp_servers.infernoflow]", 'command = "node"', String.raw`args = ['C:\Users\dana\npm\node_modules\infernoflow\dist\bin\infernoflow.mjs', "mcp"]`, String.raw`env = { INFERNOFLOW_PROJECT_DIR = 'C:\Ron\app' }`, "",
      "[mcp_servers.other]", 'command = "x"', "",
    ].join("\r\n");
    fs.writeFileSync(f, before);
    expect(updateCodexConfig(dir)).toMatchObject({ updated: true });   // an existing file is fixed on upgrade too
    expect(read(f)).toBe(['model = "o3"', "", "[mcp_servers.infernoflow]", 'command = "infernoflow"', 'args = ["mcp"]', "", "[mcp_servers.other]", 'command = "x"', ""].join("\r\n"));
    expect(readCodexEntry(dir)).toEqual({ command: "infernoflow", args: ["mcp"] });
  });

  it("never rewrites another machine's portable form", () => {
    const dir = tmp("ifx-cx-");
    fs.mkdirSync(path.join(dir, ".codex"));
    const f = path.join(dir, ".codex", "config.toml");
    const npx = '[mcp_servers.infernoflow]\ncommand = "npx"\nargs = ["-y", "infernoflow", "mcp"]\n';
    fs.writeFileSync(f, npx);
    expect(updateCodexConfig(dir, { create: true }).updated).toBe(false);
    expect(read(f)).toBe(npx);
  });

  it("removeCodexEntry drops only our table, and the file when nothing else is left", () => {
    const dir = tmp("ifx-cx-");
    fs.mkdirSync(path.join(dir, ".codex"));
    const f = path.join(dir, ".codex", "config.toml");
    fs.writeFileSync(f, 'model = "o3"\n\n[mcp_servers.infernoflow]\ncommand = "infernoflow"\nargs = ["mcp"]\n');
    expect(removeCodexEntry(dir)).toMatchObject({ removed: true });
    expect(read(f)).toBe('model = "o3"\n');
    fs.writeFileSync(f, '[mcp_servers.infernoflow]\ncommand = "infernoflow"\nargs = ["mcp"]\n');
    expect(removeCodexEntry(dir)).toMatchObject({ removed: true, deletedFile: true });
    expect(fs.existsSync(f)).toBe(false);
  });
});

describe("setup, doctor and uninstall with Codex", () => {
  const env = (home, codexHome) => ({ ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), XDG_CONFIG_HOME: path.join(home, ".config"), INFERNOFLOW_HOME: path.join(home, ".infernoflow"), CODEX_HOME: codexHome });
  const run = (args, cwd, home, codexHome) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", timeout: 60_000, env: env(home, codexHome) });
  const repo = () => { const d = path.join(tmp("ifx-cxr-"), "app"); fs.mkdirSync(d); execFileSync("git", ["init", "-q"], { cwd: d }); return d; };

  it("setup writes .codex/config.toml and AGENTS.md only on a machine with Codex", () => {
    const home = tmp("ifx-cxhome-");
    const without = repo();
    expect(run(["setup", "--yes"], without, home, path.join(home, "no-codex")).status).toBe(0);
    expect(fs.existsSync(path.join(without, ".codex"))).toBe(false);
    expect(fs.existsSync(path.join(without, "AGENTS.md"))).toBe(false);

    const codexHome = tmp("ifx-cxch-");
    const withCodex = repo();
    expect(run(["setup", "--yes"], withCodex, home, codexHome).status).toBe(0);
    expect(readCodexEntry(withCodex)).toEqual({ command: "infernoflow", args: ["mcp"] });
    expect(read(path.join(withCodex, "AGENTS.md"))).toContain("<!-- infernoflow:start -->");
  }, 120_000);

  it("doctor flags a Codex entry with machine paths; uninstall keeps the user's text", () => {
    const home = tmp("ifx-cxhome-");
    const codexHome = tmp("ifx-cxch-");
    const dir = repo();
    expect(run(["init", "--yes"], dir, home, codexHome).status).toBe(0);
    fs.writeFileSync(path.join(dir, ".codex", "config.toml"), 'model = "o3"\n\n[mcp_servers.infernoflow]\ncommand = "node"\nargs = ["/home/dana/infernoflow.mjs", "mcp"]\n');
    const j = JSON.parse(run(["doctor", "--json"], dir, home, codexHome).stdout);
    const list = j.results || j.checks || j;
    expect(list.find(r => r.label === "MCP portability")).toMatchObject({ status: "warn" });
    expect(list.find(r => r.label === "MCP portability").message).toContain(".codex");

    // A user's own CLAUDE.md text survives uninstall (it used to delete the whole file).
    const claude = path.join(dir, "CLAUDE.md");
    fs.writeFileSync(claude, "# Team notes\n\nUse pnpm.\n\n" + (fs.existsSync(claude) ? read(claude) : "<!-- infernoflow:start -->\nx\n<!-- infernoflow:end -->\n"));
    expect(run(["uninstall", "--yes"], dir, home, codexHome).status).toBe(0);
    expect(read(claude)).toContain("Use pnpm.");
    expect(read(claude)).not.toContain("infernoflow:start");
    expect(read(path.join(dir, ".codex", "config.toml"))).toBe('model = "o3"\n');
    for (const f of [".cursorrules", path.join(".github", "copilot-instructions.md"), "AGENTS.md"]) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) expect(read(p)).not.toContain("infernoflow:start");
    }
  }, 120_000);
});

/**
 * Security update propagation + shell-free prompt hooks (0.44.20).
 *
 * 1. Projects set up by older releases carry their own copy of the MCP server
 *    and of the prompt hooks. Those copies were never updated, so a fixed
 *    package still left users running vulnerable code. The upgrade backfill
 *    must replace them.
 * 2. The Claude Code prompt hook must log the prompt without ever handing it
 *    to a shell.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT  = path.resolve(__dirname, "..");
const BIN   = path.join(ROOT, "bin", "infernoflow.mjs");
const TMPL_SERVER = path.join(ROOT, "templates", "cursor", "inferno-mcp-server.mjs");
const TMPL_CURSOR_HOOK = path.join(ROOT, "templates", "cursor", "hooks", "inferno-session-draft.mjs");

const OLD_SERVER = [
  'import { execSync } from "node:child_process";',
  '// old vulnerable copy',
  'if (input.intent) parts.push(`--intent "${input.intent}"`);',
  'sendResult(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "infernoflow", version: "1.0.0" } });',
].join("\n");
const OLD_CLAUDE_HOOK = 'spawnSync("infernoflow", ["log", msg], { shell: process.platform === "win32" });\n';
const OLD_CURSOR_HOOK = 'const bin = process.platform === "win32" ? "infernoflow.cmd" : "infernoflow";\nspawnSync(bin, ["log", msg], { shell: true });\n';

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

/** A project that was set up by an old release and is now on an older .last-cli-version. */
function oldProject() {
  const dir = tmp("infernoflow-secref-");
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".ai-memory", ".last-cli-version"), "0.44.19");
  fs.writeFileSync(path.join(dir, ".ai-memory", "amp.json"), JSON.stringify({ amp: "1.0", project: "secref", config: {} }));
  fs.mkdirSync(path.join(dir, ".cursor", "hooks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".claude", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".cursor", "inferno-mcp-server.mjs"), OLD_SERVER);
  fs.writeFileSync(path.join(dir, ".cursor", "hooks", "inferno-session-draft.mjs"), OLD_CURSOR_HOOK);
  fs.writeFileSync(path.join(dir, ".claude", "hooks", "log-frustration.mjs"), OLD_CLAUDE_HOOK);
  return dir;
}

/** Isolated HOME so the backfill never touches the developer's real ~/.claude.json. */
function isolatedEnv(home, extra = {}) {
  return { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), ...extra };
}

describe("upgrade backfill replaces outdated security-sensitive copies", () => {
  let project, home;
  beforeEach(() => { project = oldProject(); home = tmp("infernoflow-home-"); });
  afterEach(() => {
    for (const d of [project, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  it("first CLI command after upgrade rewrites the MCP server and both hooks", () => {
    const r = spawnSync(process.execPath, [BIN, "log", "--show"], { cwd: project, encoding: "utf8", timeout: 30_000, env: isolatedEnv(home) });
    expect(r.status).toBe(0);

    const server = fs.readFileSync(path.join(project, ".cursor", "inferno-mcp-server.mjs"), "utf8");
    expect(server.replace(/\r\n/g, "\n")).toBe(fs.readFileSync(TMPL_SERVER, "utf8").replace(/\r\n/g, "\n"));
    expect(server).not.toContain('--intent "${input.intent}"');

    const cursorHook = fs.readFileSync(path.join(project, ".cursor", "hooks", "inferno-session-draft.mjs"), "utf8");
    expect(cursorHook).toBe(fs.readFileSync(TMPL_CURSOR_HOOK, "utf8"));

    const claudeHook = fs.readFileSync(path.join(project, ".claude", "hooks", "log-frustration.mjs"), "utf8");
    expect(claudeHook).toContain("infernoflow-hook-version: 5");
    expect(claudeHook).not.toMatch(/shell:\s*process\.platform/);

    // The user is told, on stderr, and asked to restart their AI tool.
    expect(r.stderr).toMatch(/security update/);
    expect(r.stderr).toMatch(/restart your AI tool/);
  });

  it("leaves files that are not infernoflow's alone", () => {
    fs.writeFileSync(path.join(project, ".cursor", "inferno-mcp-server.mjs"), "// my own server, not infernoflow\n");
    spawnSync(process.execPath, [BIN, "log", "--show"], { cwd: project, encoding: "utf8", timeout: 30_000, env: isolatedEnv(home) });
    expect(fs.readFileSync(path.join(project, ".cursor", "inferno-mcp-server.mjs"), "utf8")).toBe("// my own server, not infernoflow\n");
  });
});

describe("Claude Code prompt hook never uses a shell", () => {
  let project, home, fakeBin;
  beforeEach(async () => {
    project = tmp("infernoflow-hook-");
    home    = tmp("infernoflow-home-");
    fakeBin = tmp("infernoflow-bin-");
    fs.mkdirSync(path.join(project, ".ai-memory"), { recursive: true });
    fs.mkdirSync(path.join(project, ".git"), { recursive: true });
    fs.writeFileSync(path.join(project, ".ai-memory", ".last-cli-version"), JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version);
    // Put an `infernoflow` launcher on PATH that resolves to the repo CLI.
    if (process.platform === "win32") {
      // Mirror the npm global layout: <prefix>/infernoflow.cmd + <prefix>/node_modules/infernoflow/bin/infernoflow.mjs
      fs.writeFileSync(path.join(fakeBin, "infernoflow.cmd"), "@echo off\r\n");
      const pkg = path.join(fakeBin, "node_modules", "infernoflow");
      fs.mkdirSync(path.dirname(pkg), { recursive: true });
      fs.symlinkSync(ROOT, pkg, "junction");
    } else {
      // Mirror the npm global layout: <prefix>/bin/infernoflow + <prefix>/lib/node_modules/infernoflow
      fs.mkdirSync(path.join(fakeBin, "bin"));
      fs.writeFileSync(path.join(fakeBin, "bin", "infernoflow"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
      fs.mkdirSync(path.join(fakeBin, "lib", "node_modules"), { recursive: true });
      fs.symlinkSync(ROOT, path.join(fakeBin, "lib", "node_modules", "infernoflow"));
    }
    const { CAPTURE_HOOK_SCRIPT } = await import("../lib/commands/setup.mjs");
    fs.mkdirSync(path.join(project, ".claude", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(project, ".claude", "hooks", "log-frustration.mjs"), CAPTURE_HOOK_SCRIPT);
  });
  afterEach(() => {
    for (const d of [project, home, fakeBin]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  });

  it("logs the prompt as text; shell metacharacters do nothing", () => {
    const marker = path.join(project, "PWNED").replace(/\\/g, "/");
    const js = `node -e "require('fs').writeFileSync('${marker}','x')"`;
    const prompt = `still not working & ${js} | ${js} ; ${js} $(${js}) \`${js}\``;
    const r = spawnSync(process.execPath, [path.join(".claude", "hooks", "log-frustration.mjs")], {
      cwd: project,
      input: JSON.stringify({ prompt }),
      encoding: "utf8",
      timeout: 30_000,
      env: isolatedEnv(home, { PATH: (process.platform === "win32" ? fakeBin : path.join(fakeBin, "bin")) + path.delimiter + process.env.PATH }),
    });
    expect(r.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);

    const sessions = path.join(project, ".ai-memory", "sessions.jsonl");
    expect(fs.existsSync(sessions)).toBe(true);
    const text = fs.readFileSync(sessions, "utf8");
    expect(text).toContain("User frustration: still not working &");
    // R5.2 (0.46.1): at most 60 characters of the prompt are kept.
    const logged = JSON.parse(text.split("\n").find(l => l.includes("User frustration:"))).msg;
    expect(logged.length).toBeLessThanOrEqual("User frustration: ".length + 60);
  });
});

describe("0.46.3: a newer copy is never replaced by an older infernoflow", () => {
  let project, home;
  beforeEach(() => { project = oldProject(); home = tmp("infernoflow-home-"); });
  afterEach(() => { for (const d of [project, home]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

  it("hooks and server written by a later version are left alone", () => {
    const newerHook = "// infernoflow-hook-version: 99\n// from the future\n";
    const newerServer = '// infernoflow-server-version: 99\nconsole.error("[infernoflow MCP] future");\n';
    fs.writeFileSync(path.join(project, ".claude", "hooks", "log-frustration.mjs"), newerHook);
    fs.writeFileSync(path.join(project, ".cursor", "hooks", "inferno-session-draft.mjs"), newerHook);
    fs.writeFileSync(path.join(project, ".cursor", "inferno-mcp-server.mjs"), newerServer);
    spawnSync(process.execPath, [BIN, "log", "--show"], { cwd: project, encoding: "utf8", timeout: 30_000, env: isolatedEnv(home) });
    expect(fs.readFileSync(path.join(project, ".claude", "hooks", "log-frustration.mjs"), "utf8")).toBe(newerHook);
    expect(fs.readFileSync(path.join(project, ".cursor", "hooks", "inferno-session-draft.mjs"), "utf8")).toBe(newerHook);
    expect(fs.readFileSync(path.join(project, ".cursor", "inferno-mcp-server.mjs"), "utf8")).toBe(newerServer);
  });
});

describe("the MCP server template's version marker is bumped with every change", () => {
  // Copies are only replaced by a NEWER version (0.46.3), so a changed
  // template with the same number would never reach existing projects.
  // When this fails: bump "infernoflow-server-version" and record the new hash.
  const KNOWN = { 1: "b8fd0a82562476aa13e1b7182dcc07551ab7e8ee4bc7d789550fa54920233c5c" };
  it("the current template matches the hash recorded for its version", async () => {
    const { createHash } = await import("node:crypto");
    const text = fs.readFileSync(TMPL_SERVER, "utf8").replace(/\r\n/g, "\n");
    const version = Number((/infernoflow-server-version:\s*(\d+)/.exec(text) || [])[1]);
    expect(createHash("sha256").update(text).digest("hex"), "template changed — bump infernoflow-server-version").toBe(KNOWN[version]);
  });
});

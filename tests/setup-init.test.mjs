/**
 * 0.49.0 — `setup` in a project without .ai-memory runs init with THIS CLI.
 * It used to run `npx infernoflow init` through a shell, i.e. whatever version
 * npm had published (on CI that wrote 0.48.0's files over the code under test).
 */
import { it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

it("setup never shells out to npx to run init", () => {
  const dir = path.join(tmp("ifx-si-"), "app");
  fs.mkdirSync(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const home = tmp("ifx-sih-");
  const bin = tmp("ifx-sib-");
  const marker = path.join(bin, "npx-was-called");
  // A fake npx first on PATH: if setup calls it, we see the marker.
  if (process.platform === "win32") fs.writeFileSync(path.join(bin, "npx.cmd"), `@echo called> "${marker}"\r\n@exit /b 1\r\n`);
  else { fs.writeFileSync(path.join(bin, "npx"), `#!/bin/sh\necho called > "${marker}"\nexit 1\n`); fs.chmodSync(path.join(bin, "npx"), 0o755); }
  const r = spawnSync(process.execPath, [BIN, "setup", "--yes"], {
    cwd: dir, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), XDG_CONFIG_HOME: path.join(home, ".config"), INFERNOFLOW_HOME: path.join(home, ".infernoflow"), CODEX_HOME: path.join(home, "no-codex"), PATH: bin + path.delimiter + process.env.PATH },
  });
  expect(r.status).toBe(0);
  expect(fs.existsSync(marker)).toBe(false);
  expect(fs.existsSync(path.join(dir, ".ai-memory", "amp.json"))).toBe(true);        // init ran (this CLI)
}, 60_000);

it("setup reports what is really installed, with the reason for anything skipped", () => {
  const dir = path.join(tmp("ifx-ss2-"), "app");
  fs.mkdirSync(dir);
  const home = tmp("ifx-ss2h-");
  const env = { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming"), XDG_CONFIG_HOME: path.join(home, ".config"), INFERNOFLOW_HOME: path.join(home, ".infernoflow"), CODEX_HOME: path.join(home, "no-codex") };
  // Plain Windows consoles get ASCII symbols ([OK], *, ->): compare in one form.
  const norm = (s) => String(s).replace(/\[OK\]/g, "✔").replace(/\[X\]/g, "✘").replace(/ -> /g, " → ").replace(/^(\s*)\* /gm, "$1· ");
  const setup = () => norm(spawnSync(process.execPath, [BIN, "setup", "--yes"], { cwd: dir, encoding: "utf8", timeout: 60_000, env }).stdout);
  // No git yet: everything but the pre-commit note, which says why.
  let out = setup();
  for (const l of ["✔ Memory store", "✔ Claude Code", "✔ Cursor", "✔ VS Code Copilot", "✔ Git policy"]) expect(out, l).toContain(l);
  expect(out).toMatch(/· Git pre-commit note \(not a git repository/);
  expect(out).toMatch(/· Codex \(Codex isn't installed/);
  // A second run (nothing left to change) still lists everything — it used to show only 3 lines.
  execFileSync("git", ["init", "-q"], { cwd: dir });
  out = setup();
  expect(out).toContain("✔ Git pre-commit note → .git/hooks/pre-commit");
  expect(out).toContain("✔ Claude Code → .mcp.json, session hooks, prompt hook, skill, memory-keeper agent");
  expect(out).not.toContain("✘");
}, 120_000);

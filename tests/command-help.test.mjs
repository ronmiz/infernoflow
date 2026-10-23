// 0.46.5: `<command> --help` must print help and change nothing.
// Before, most commands ignored --help and ran: `refresh --help` rewrote rule
// files, `setup --help` wired MCP configs, `install-*-hooks --help` installed
// hooks, and the upgrade backfill ran first in every case.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_HELP, OWN_HELP } from "../lib/commandHelp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN  = path.join(ROOT, "bin", "infernoflow.mjs");

function run(args, cwd, home) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: "utf8", timeout: 30_000, input: "",
    env: { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, INFERNOFLOW_HOME: path.join(home, ".infernoflow") },
  });
}

/** Every command the CLI dispatches, read from `infernoflow commands`. */
function allCommands() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "if-help-home-"));
  const out = run(["commands"], ROOT, home).stdout;
  return [...out.matchAll(/^ {4}([a-z][a-z-]*) {2,}/gm)].map(m => m[1]);
}

describe("per-command --help", () => {
  const cmds = allCommands();

  it("lists every command and each one has help", () => {
    expect(cmds.length).toBeGreaterThanOrEqual(25);
    for (const c of cmds) expect(Boolean(COMMAND_HELP[c] || OWN_HELP.has(c)), c).toBe(true);
  });

  it("--help and -h exit 0, print usage and write nothing", () => {
    for (const c of cmds) {
      for (const flag of ["--help", "-h"]) {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "if-help-home-"));
        const dir  = fs.mkdtempSync(path.join(os.tmpdir(), "if-help-proj-"));
        const r = run([c, flag], dir, home);
        expect(r.status, `${c} ${flag}: ${r.stderr}`).toBe(0);
        expect(r.stdout, `${c} ${flag}`).toMatch(/Usage/i);
        expect(fs.readdirSync(dir), `${c} ${flag} wrote files`).toEqual([]);
      }
    }
  }, 120_000);

  it("the main help starts with the everyday commands", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "if-help-home-"));
    const out = run(["--help"], ROOT, home).stdout;
    for (const c of ["init", "log", "ask", "resume", "bookmark", "status"]) expect(out).toContain(c);
    expect(out).toContain("infernoflow commands");
  });
});

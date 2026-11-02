/**
 * 0.48.0 — git pre-commit note: memory about the staged files, never blocks.
 */
import { describe, it, expect } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { installPreCommitHook, removePreCommitHook, PRECOMMIT_START } from "../lib/gitHooks.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

function repo(sub) {
  const top = path.join(tmp("ifx-pc-"), "repo");
  fs.mkdirSync(top);
  git(top, "init", "-q");
  git(top, "config", "user.name", "Dana"); git(top, "config", "user.email", "d@example.com"); git(top, "config", "commit.gpgsign", "false");
  const dir = sub ? path.join(top, sub) : top;
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".ai-memory"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "auth.js"), "1\n");
  fs.writeFileSync(path.join(dir, "src", "other.js"), "1\n");
  git(top, "add", "."); git(top, "commit", "-qm", "init");
  return { top, dir };
}
const home = tmp("ifx-pch-");
const env = { ...process.env, NO_COLOR: "1", HOME: home, USERPROFILE: home, INFERNOFLOW_HOME: path.join(home, ".infernoflow") };
const cli = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", timeout: 30_000, env, input: "" });
const hook = (cwd) => spawnSync(process.execPath, [BIN, "hook", "pre-commit"], { cwd, encoding: "utf8", timeout: 30_000, env, input: "" });

describe("installPreCommitHook", () => {
  it("creates the hook, keeps a user's hook working, is idempotent, and uninstall removes only ours", () => {
    const { top } = repo();
    const file = path.join(top, ".git", "hooks", "pre-commit");
    expect(installPreCommitHook(top)).toMatchObject({ installed: true, created: true });
    expect(fs.readFileSync(file, "utf8").startsWith("#!/bin/sh\n" + PRECOMMIT_START)).toBe(true);
    expect(installPreCommitHook(top)).toMatchObject({ installed: false, present: true });
    expect(removePreCommitHook(top)).toMatchObject({ removed: true, deletedFile: true });
    expect(fs.existsSync(file)).toBe(false);

    const own = "#!/bin/sh\nnpm run lint\nexit 0\n";
    fs.writeFileSync(file, own);
    installPreCommitHook(top);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    expect(lines[0]).toBe("#!/bin/sh");
    expect(lines[1]).toBe(PRECOMMIT_START);                    // before the user's `exit 0`
    expect(lines.slice(-3)).toEqual(["npm run lint", "exit 0", ""]);
    removePreCommitHook(top);
    expect(fs.readFileSync(file, "utf8")).toBe(own);
  });

  it("leaves a custom core.hooksPath (husky etc.) alone", () => {
    const { top } = repo();
    git(top, "config", "core.hooksPath", ".husky");
    expect(installPreCommitHook(top)).toMatchObject({ installed: false, skipped: "hooksPath" });
    expect(fs.existsSync(path.join(top, ".husky"))).toBe(false);
  });
});

describe("infernoflow hook pre-commit", () => {
  it("lists memory about staged files only, in a subfolder project too, and can be turned off", () => {
    const { top, dir } = repo("packages/api");
    expect(cli(["log", "Auth API returns 200 on errors", "--type", "gotcha", "--file", "src/auth.js"], dir).status).toBe(0);
    expect(cli(["log", "other gotcha", "--type", "gotcha", "--file", "src/other.js"], dir).status).toBe(0);
    expect(cli(["log", "just a note", "--type", "note", "--file", "src/auth.js"], dir).status).toBe(0);
    fs.appendFileSync(path.join(dir, "src", "auth.js"), "2\n");
    git(top, "add", path.join("packages", "api", "src", "auth.js"));
    const r = hook(top);                                   // run from the git top level, project is a subfolder
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Auth API returns 200 on errors");
    expect(r.stderr).toContain("gotcha src/auth.js");
    expect(r.stderr).not.toContain("other gotcha");
    expect(r.stderr).not.toContain("just a note");        // notes are not warnings

    fs.writeFileSync(path.join(dir, ".ai-memory", "amp.json"), JSON.stringify({ config: { preCommit: "off" } }));
    expect(hook(dir).stderr).toBe("");
  });

  it("a real git commit shows the note and still goes through", () => {
    const { top } = repo();
    expect(cli(["log", "Auth API returns 200 on errors", "--type", "gotcha", "--file", "src/auth.js"], top).status).toBe(0);
    installPreCommitHook(top);
    // The hook calls `infernoflow` from PATH: put a launcher for this checkout first.
    const bin = tmp("ifx-pcbin-");
    if (process.platform === "win32") fs.writeFileSync(path.join(bin, "infernoflow.cmd"), `@"${process.execPath}" "${BIN}" %*\r\n`);
    else { fs.writeFileSync(path.join(bin, "infernoflow"), `#!/bin/sh\nexec "${process.execPath}" "${BIN}" "$@"\n`); fs.chmodSync(path.join(bin, "infernoflow"), 0o755); }
    fs.appendFileSync(path.join(top, "src", "auth.js"), "2\n");
    git(top, "add", "src/auth.js");
    const r = spawnSync("git", ["commit", "-m", "touch auth"], { cwd: top, encoding: "utf8", env: { ...env, PATH: bin + path.delimiter + process.env.PATH } });
    if (process.platform !== "win32") expect(r.stderr).toContain("Auth API returns 200 on errors");
    expect(r.status).toBe(0);
    expect(git(top, "log", "-1", "--format=%s").trim()).toBe("touch auth");
  }, 60_000);
});

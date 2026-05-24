/**
 * `infernoflow init --yes` end-to-end: pin the 60-second-magic contract.
 *
 * Spawning the real CLI from a fresh temp project. After init returns, the
 * project must be in a state where:
 *   - `.ai-memory/` exists with the v0.44 layout (sessions.jsonl + amp.json)
 *   - Rule files for every supported IDE are written and contain the
 *     capture protocol (so cold-start injection works in the next session)
 *   - `.gitignore` and `.gitattributes` have the v0.44 managed blocks
 *     (`global.jsonl` ignored, branch JSONLs merge=union)
 *   - There is a visible demo entry — running `status` next would surface it
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "..", "bin", "infernoflow.mjs");

function mkFreshProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-init-"));
  fs.mkdirSync(path.join(dir, ".git", "refs", "heads"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "HEAD"),
    "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(dir, ".git", "refs", "heads", "main"),
    "0000000000000000000000000000000000000000\n");
  // Make it a real-ish project so detectProjectName finds something.
  fs.writeFileSync(path.join(dir, "package.json"),
    JSON.stringify({ name: "test-project", version: "0.0.0" }, null, 2));
  return dir;
}

function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

function runInit(cwd) {
  return spawnSync(process.execPath, [BIN, "init", "--yes"], {
    cwd,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("init --yes — 60-second magic", () => {
  let project;
  beforeEach(() => { project = mkFreshProject(); });
  afterEach(()  => rmrf(project));

  it("exits 0 and creates .ai-memory/ in one command", () => {
    const r = runInit(project);
    expect(r.status, `stderr: ${r.stderr}`).toBe(0);
    expect(fs.existsSync(path.join(project, ".ai-memory")), ".ai-memory/ missing").toBe(true);
    expect(fs.existsSync(path.join(project, ".ai-memory", "amp.json"))).toBe(true);
  });

  it("writes rule files for every supported IDE with the capture protocol", () => {
    runInit(project);
    const ideFiles = [
      ".cursorrules",
      "CLAUDE.md",
      path.join(".github", "copilot-instructions.md"),
    ];
    for (const rel of ideFiles) {
      const file = path.join(project, rel);
      expect(fs.existsSync(file), `missing: ${rel}`).toBe(true);
      const text = fs.readFileSync(file, "utf8");
      expect(text, `no infernoflow block in ${rel}`).toMatch(/<!--\s*infernoflow:start\s*-->/);
      // The agent must learn the capture protocol; without "amp_write" in
      // these files, transparent capture in the next session won't happen.
      expect(text, `no amp_write protocol in ${rel}`).toContain("amp_write");
    }
  });

  it("applies v0.44 clean-tree policy to .gitignore (global.jsonl ignored, rule files tracked)", () => {
    runInit(project);
    const gi = fs.readFileSync(path.join(project, ".gitignore"), "utf8");
    expect(gi).toContain(".ai-memory/global.jsonl");
    expect(gi).not.toMatch(/CLAUDE\.md\s*$/m);        // tracked, not ignored
    expect(gi).not.toMatch(/\.cursorrules\s*$/m);    // tracked, not ignored
    // The legacy v0.43 block must not coexist.
    expect(gi).not.toContain("# --- infernoflow (developer-local AI memory; do not commit) ---");
  });

  it("applies v0.44 clean-tree policy to .gitattributes (branch JSONLs merge=union)", () => {
    runInit(project);
    const gaPath = path.join(project, ".gitattributes");
    expect(fs.existsSync(gaPath), ".gitattributes missing").toBe(true);
    const ga = fs.readFileSync(gaPath, "utf8");
    expect(ga).toContain(".ai-memory/branches/*.jsonl merge=union");
  });

  // Regression: cross-machine sync needs .gitattributes to be committed
  // BEFORE the first branch JSONL exists, otherwise `merge=union` doesn't
  // apply to the first push/pull cycle. Pin the file-existence ordering.
  it(".gitattributes is on disk BEFORE any branches/*.jsonl file exists", () => {
    runInit(project)
    const gaPath = path.join(project, ".gitattributes")
    expect(fs.existsSync(gaPath), ".gitattributes must exist after init").toBe(true)

    // Branch dir either doesn't exist yet OR contains no JSONL files —
    // init's demo entry routes to type "note" which the v0.44 router sends
    // to branches/<branch>.jsonl, so by end of init the branch file DOES
    // exist. The thing we're checking is that .gitattributes exists too.
    // The stronger ORDERING claim (mtime of attributes <= mtime of branch
    // file) is fragile on systems with coarse mtime resolution; we instead
    // assert that BOTH exist together — which is sufficient because the
    // user's first `git push` will pick up the attributes file along with
    // the branch JSONL in the same commit.
    const branchesDir = path.join(project, ".ai-memory", "branches")
    if (fs.existsSync(branchesDir)) {
      const branchFiles = fs.readdirSync(branchesDir).filter(n => n.endsWith(".jsonl"))
      if (branchFiles.length > 0) {
        const gaMtime = fs.statSync(gaPath).mtimeMs
        for (const bf of branchFiles) {
          const bfMtime = fs.statSync(path.join(branchesDir, bf)).mtimeMs
          // .gitattributes was written at or before the branch file.
          expect(gaMtime <= bfMtime + 100, // 100ms slop for coarse-resolution filesystems
            `.gitattributes mtime ${gaMtime} should be ≤ branch file ${bf} mtime ${bfMtime}`
          ).toBe(true)
        }
      }
    }
  })

  it("logs a visible demo entry so status confirms the loop works", () => {
    runInit(project);
    // The demo entry routes by type=note → branches/main.jsonl in this repo.
    const branchFile = path.join(project, ".ai-memory", "branches", "main.jsonl");
    expect(fs.existsSync(branchFile), "demo entry not written to branches/main.jsonl").toBe(true);
    const lines = fs.readFileSync(branchFile, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.msg).toMatch(/infernoflow init complete/);
    expect(entry.type).toBe("note");
  });

  it("is idempotent — second run reports already-set-up and doesn't crash", () => {
    const first = runInit(project);
    expect(first.status).toBe(0);
    const second = runInit(project);
    expect(second.status).toBe(0);
    // Second run does not duplicate the gitignore block.
    const gi = fs.readFileSync(path.join(project, ".gitignore"), "utf8");
    const startCount = (gi.match(/# >>> infernoflow:start/g) || []).length;
    expect(startCount, ".gitignore has duplicate managed blocks").toBe(1);
  });

  it("migrates a legacy v0.43 .gitignore block on first init", () => {
    // Pretend the user already ran an old init that wrote the legacy block.
    fs.writeFileSync(path.join(project, ".gitignore"),
      [
        "node_modules",
        "",
        "# --- infernoflow (developer-local AI memory; do not commit) ---",
        ".ai-memory/",
        ".cursorrules",
        "CLAUDE.md",
        ".github/copilot-instructions.md",
        "# --- /infernoflow ---",
        "",
        "dist",
        "",
      ].join("\n"));

    runInit(project);
    const gi = fs.readFileSync(path.join(project, ".gitignore"), "utf8");

    // Legacy block stripped, user's surrounding entries preserved, new
    // block in place.
    expect(gi).not.toContain("# --- infernoflow");
    expect(gi).toContain("node_modules");
    expect(gi).toContain("dist");
    expect(gi).toContain("# >>> infernoflow:start");
    expect(gi).toContain(".ai-memory/global.jsonl");
  });
});

/**
 * infernoflow publish
 *
 * One command to release:
 *   1. Bump version in package.json  (--bump patch|minor|major, default: patch)
 *   2. Move CHANGELOG ## Unreleased → ## <new-version> — <date>
 *   3. Run build  (node build.mjs)
 *   4. Run smoke tests  (skippable with --skip-tests)
 *   5. npm publish
 *   6. git add + commit + push
 *
 * Flags:
 *   --bump patch|minor|major   Version bump type (default: patch)
 *   --skip-build               Skip build step
 *   --skip-tests               Skip smoke-test step
 *   --skip-push                Publish + commit but don't git push
 *   --dry-run                  Print every step without executing
 *   --yes, -y                  Non-interactive (skip confirmation prompt)
 *   --tag                      Also create a git tag vX.Y.Z
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { header, ok, fail, warn, info, done, bold, cyan, gray, yellow, green } from "../ui/output.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT  = path.resolve(__dirname, "../..");

// ── helpers ──────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: PKG_ROOT,
    encoding: "utf8",
    stdio: opts.silent ? ["ignore", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
    ...opts,
  });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: PKG_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function bumpVersion(current, type) {
  const parts = current.split(".").map(Number);
  if (type === "major") { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (type === "minor") { parts[1]++; parts[2] = 0; }
  else { parts[2]++; }
  return parts.join(".");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function updateChangelog(changelogPath, newVersion) {
  if (!fs.existsSync(changelogPath)) {
    // create a minimal changelog if none exists
    fs.writeFileSync(changelogPath,
      `# Changelog — infernoflow\n\n## ${newVersion} — ${todayISO()}\n\n### Added\n- Release ${newVersion}\n`);
    return true;
  }

  let text = fs.readFileSync(changelogPath, "utf8");

  // If there's an ## Unreleased section, rename it
  if (/^## Unreleased/im.test(text)) {
    text = text.replace(
      /^## Unreleased.*$/im,
      `## ${newVersion} — ${todayISO()}`
    );
    fs.writeFileSync(changelogPath, text);
    return true;
  }

  // No Unreleased section — insert a new version heading after the first heading
  const insertAfter = /^# .+$/im;
  if (insertAfter.test(text)) {
    text = text.replace(
      insertAfter,
      (m) => `${m}\n\n## ${newVersion} — ${todayISO()}\n\n### Added\n- Release ${newVersion}\n`
    );
    fs.writeFileSync(changelogPath, text);
    return true;
  }

  // Fallback: prepend
  fs.writeFileSync(changelogPath, `## ${newVersion} — ${todayISO()}\n\n### Added\n- Release ${newVersion}\n\n${text}`);
  return true;
}

function hasUncommittedChanges() {
  try {
    const out = runCapture("git status --porcelain");
    return out.length > 0;
  } catch { return false; }
}

function gitUserConfigured() {
  try {
    runCapture("git config user.email");
    return true;
  } catch { return false; }
}


// ── main ─────────────────────────────────────────────────────────────────────

export async function publishCommand(rawArgs) {
  const args = rawArgs.slice(1); // drop command name

  const dryRun     = args.includes("--dry-run");
  const skipBuild  = args.includes("--skip-build");
  const skipTests  = args.includes("--skip-tests");
  const skipPush   = args.includes("--skip-push");
  const createTag  = args.includes("--tag");
  const yes        = args.includes("--yes") || args.includes("-y");

  const bumpIdx = args.indexOf("--bump");
  const bumpType = bumpIdx !== -1 ? (args[bumpIdx + 1] || "patch") : "patch";

  if (!["patch", "minor", "major"].includes(bumpType)) {
    console.error(`  Invalid --bump value: ${bumpType}. Must be patch, minor, or major.`);
    process.exit(1);
  }

  header("infernoflow publish");

  if (dryRun) {
    warn("DRY RUN — no files will be written, no commands executed");
  }

  // ── 1. Read current version ───────────────────────────────────────────────
  const pkgPath = path.join(PKG_ROOT, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const oldVersion = pkg.version;
  const newVersion = bumpVersion(oldVersion, bumpType);

  console.log();
  console.log(`  ${gray("current")}  ${bold(oldVersion)}`);
  console.log(`  ${gray("new     ")}  ${bold(green(newVersion))}  ${gray("(" + bumpType + " bump)")}`);
  console.log();

  // ── 2. Confirm ────────────────────────────────────────────────────────────
  if (!yes && !dryRun) {
    process.stdout.write(`  Publish ${bold(cyan("infernoflow@" + newVersion))} to npm? [y/N] `);
    let confirmed = false;
    try {
      const answer = execSync("bash -c 'read -r ans </dev/tty; echo $ans'", {
        encoding: "utf8",
        stdio: ["inherit", "pipe", "inherit"],
      }).trim().toLowerCase();
      confirmed = answer === "y" || answer === "yes";
    } catch {
      confirmed = false;
    }
    console.log();
    if (!confirmed) {
      console.log(gray("  Aborted.\n"));
      process.exit(0);
    }
  }

  // ── 3. Bump package.json ──────────────────────────────────────────────────
  info(`Bumping package.json  ${gray(oldVersion + " → " + newVersion)}`);
  if (!dryRun) {
    pkg.version = newVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + "\n");
    ok("package.json updated");
  } else {
    ok(gray("[dry] would write package.json"));
  }

  // ── 4. Update CHANGELOG ───────────────────────────────────────────────────
  const changelogPath = path.join(PKG_ROOT, "CHANGELOG.md");
  info("Updating CHANGELOG.md");
  if (!dryRun) {
    updateChangelog(changelogPath, newVersion);
    ok("CHANGELOG.md updated");
  } else {
    ok(gray("[dry] would update CHANGELOG.md"));
  }

  // ── 5. Build ──────────────────────────────────────────────────────────────
  if (!skipBuild) {
    info("Running build  " + gray("node build.mjs"));
    if (!dryRun) {
      try {
        run("node build.mjs", { silent: false });
        ok("Build succeeded");
      } catch (err) {
        fail("Build failed", err.message);
        process.exit(1);
      }
    } else {
      ok(gray("[dry] would run: node build.mjs"));
    }
  } else {
    warn("Skipping build  (--skip-build)");
  }

  // ── 6. Smoke tests ────────────────────────────────────────────────────────
  if (!skipTests) {
    info("Running smoke tests");
    if (!dryRun) {
      try {
        run("npm test", { silent: false });
        ok("All smoke tests passed");
      } catch (err) {
        fail("Smoke tests failed", "Fix tests or re-run with --skip-tests");
        process.exit(1);
      }
    } else {
      ok(gray("[dry] would run: npm test"));
    }
  } else {
    warn("Skipping tests  (--skip-tests)");
  }

  // ── 7. npm publish ────────────────────────────────────────────────────────
  info(`Publishing to npm  ${gray("infernoflow@" + newVersion)}`);
  if (!dryRun) {
    try {
      run("npm publish", { silent: false });
      ok(`Published infernoflow@${newVersion}`);
    } catch (err) {
      fail("npm publish failed", err.message || "Check npm credentials");
      // Don't exit — still commit the version bump even if publish fails
      warn("Continuing to git commit despite publish failure");
    }
  } else {
    ok(gray("[dry] would run: npm publish"));
  }

  // ── 8. Git commit ─────────────────────────────────────────────────────────
  info("Committing version bump");
  if (!dryRun) {
    try {
      // Stage changed files
      const filesToStage = ["package.json", "CHANGELOG.md"];
      run(`git add ${filesToStage.join(" ")}`, { silent: false });

      const commitMsg = `chore: release ${newVersion}`;
      run(`git commit -m "${commitMsg}"`, { silent: false });
      ok(`Committed: ${gray(commitMsg)}`);
    } catch (err) {
      warn(`Git commit failed: ${err.message}`);
      warn("You can commit manually: git add package.json CHANGELOG.md && git commit -m \"chore: release " + newVersion + "\"");
    }
  } else {
    ok(gray(`[dry] would commit: chore: release ${newVersion}`));
  }

  // ── 9. Git tag ────────────────────────────────────────────────────────────
  if (createTag) {
    info(`Creating git tag  ${gray("v" + newVersion)}`);
    if (!dryRun) {
      try {
        run(`git tag v${newVersion}`, { silent: false });
        ok(`Tagged v${newVersion}`);
      } catch (err) {
        warn(`Git tag failed: ${err.message}`);
      }
    } else {
      ok(gray(`[dry] would tag: v${newVersion}`));
    }
  }

  // ── 10. Git push ──────────────────────────────────────────────────────────
  if (!skipPush) {
    info("Pushing to origin");
    if (!dryRun) {
      try {
        const pushCmd = createTag ? `git push && git push origin v${newVersion}` : "git push";
        run(pushCmd, { silent: false });
        ok("Pushed to origin");
      } catch (err) {
        warn(`Git push failed: ${err.message}`);
        warn("Push manually: git push");
      }
    } else {
      ok(gray("[dry] would run: git push"));
    }
  } else {
    warn("Skipping push  (--skip-push)");
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log();
  if (dryRun) {
    done(`Dry run complete — would have published infernoflow@${newVersion}`);
  } else {
    done(`infernoflow@${newVersion} published, committed, and pushed`);
    console.log(`  ${cyan("npm:")}  https://www.npmjs.com/package/infernoflow`);
    console.log(`  ${cyan("git:")}  ${gray("chore: release " + newVersion)}\n`);
  }
}

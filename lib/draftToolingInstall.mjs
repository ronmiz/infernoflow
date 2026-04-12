import * as fs from "node:fs";
import * as path from "node:path";

const GITIGNORE_SNIPPET = `
# infernoflow: agent draft (IDE hooks — review before commit)
inferno/CONTEXT.draft.md
`.trimStart();

function upsertPromoteScript(cwd, silent, logOk) {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    if (!silent) logOk("No package.json — add script manually: inferno:promote-draft");
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.scripts = pkg.scripts || {};
  if (!pkg.scripts["inferno:promote-draft"]) {
    pkg.scripts["inferno:promote-draft"] = "node scripts/inferno-promote-draft.mjs";
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    if (!silent) logOk("Updated package.json script: inferno:promote-draft");
  }
}

/**
 * inferno/CONTEXT.draft.md gitignore + promote script (shared by Cursor and VS Code installers).
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.templatesRoot
 * @param {boolean} opts.force
 * @param {boolean} opts.silent
 * @param {(msg: string) => void} [opts.logOk]
 * @param {(msg: string) => void} [opts.logWarn]
 */
export function installInfernoDraftTooling(opts) {
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

  const srcPromote = path.join(templatesRoot, "scripts", "inferno-promote-draft.mjs");
  const dstPromote = path.join(cwd, "scripts", "inferno-promote-draft.mjs");
  copyFile(srcPromote, dstPromote);

  upsertPromoteScript(cwd, silent, logOk);

  const gi = path.join(cwd, ".gitignore");
  if (fs.existsSync(gi)) {
    const cur = fs.readFileSync(gi, "utf8");
    if (cur.includes("CONTEXT.draft.md")) {
      if (!silent) logOk(".gitignore already mentions CONTEXT.draft.md");
    } else {
      fs.appendFileSync(gi, `\n${GITIGNORE_SNIPPET}\n`, "utf8");
      if (!silent) logOk("Updated: " + path.relative(cwd, gi));
    }
  } else {
    fs.writeFileSync(gi, `${GITIGNORE_SNIPPET}\n`, "utf8");
    if (!silent) logOk("Created: " + path.relative(cwd, gi));
  }
}

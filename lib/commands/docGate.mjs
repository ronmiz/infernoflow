import { execSync } from "node:child_process";
import { ok, fail, warn, info, gray } from "../ui/output.mjs";

function sh(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
}

const CODE_PREFIXES = [
  "src/", "frontend/", "backend/",
  "app/", "pages/", "components/",
  "Controllers/", "Services/", "Endpoints/",
  "lib/", "api/", "server/"
];

export async function docGateCommand(opts = {}) {
  const fromArgs = Array.isArray(opts);
  const silent = fromArgs ? false : (opts?.silent || false);
  const captureExit = fromArgs ? false : (opts?.captureExit || false);
  const jsonOut = fromArgs ? opts.includes("--json") : Boolean(opts?.json);
  const base = process.env.BASE_SHA || "HEAD~1";
  const head = process.env.HEAD_SHA || "HEAD";

  let files = [];
  try {
    const out = sh(`git diff --name-only ${base}..${head}`);
    files = out ? out.split("\n").filter(Boolean) : [];
  } catch {
    if (jsonOut) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason: "no_git_available" }, null, 2));
      return;
    }
    if (!silent) info(gray("doc-gate skipped (no git available)"));
    return;
  }

  if (files.length === 0) {
    if (jsonOut) {
      console.log(JSON.stringify({ ok: true, changedFiles: 0, changedCode: false, changedInferno: false }, null, 2));
      return;
    }
    if (!silent) ok("doc-gate: no changed files");
    return;
  }

  const changedCode = files.some(f =>
    CODE_PREFIXES.some(p => f.startsWith(p) || f.includes("/" + p))
  );
  const changedInferno = files.some(f => f.startsWith("inferno/"));
  const codeFiles = files.filter(f => CODE_PREFIXES.some(p => f.startsWith(p))).slice(0, 5);

  if (jsonOut) {
    const payload = {
      ok: !(changedCode && !changedInferno),
      changedFiles: files.length,
      changedCode,
      changedInferno,
      sampleCodeFiles: codeFiles,
      hint: changedCode && !changedInferno ? "Update at least one file in inferno/ before committing" : null,
    };
    console.log(JSON.stringify(payload, null, 2));
    if (!payload.ok) process.exit(1);
    return;
  }

  if (changedCode && !changedInferno) {
    if (!silent) {
      fail(
        "Code changed but inferno/ was NOT updated",
        "Update at least one file in inferno/ before committing"
      );
      if (codeFiles.length) {
        console.log();
        codeFiles.forEach(f => console.log("      " + gray("• " + f)));
      }
    }
    if (captureExit) throw new Error("doc-gate failed");
    process.exit(1);
  }

  if (!silent) ok("doc-gate: docs are up to date");
}

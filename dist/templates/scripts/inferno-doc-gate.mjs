#!/usr/bin/env node
// inferno-doc-gate.mjs
// Run as a git pre-push or CI step:
//   node scripts/inferno-doc-gate.mjs
import { execSync } from "node:child_process";

const CODE_PREFIXES = ["src/", "frontend/", "backend/", "app/", "pages/", "components/", "lib/", "api/"];
const INFERNO_PATTERNS = [f => f.startsWith("inferno/")];

function sh(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8").trim();
}

const base = process.env.BASE_SHA || "HEAD~1";
const head = process.env.HEAD_SHA || "HEAD";

let files = [];
try {
  const out = sh(`git diff --name-only ${base}..${head}`);
  files = out ? out.split("\n").filter(Boolean) : [];
} catch {
  console.log("[inferno doc-gate] skipped (git unavailable)");
  process.exit(0);
}

const changedCode = files.some(f => CODE_PREFIXES.some(p => f.startsWith(p)));
const changedInferno = files.some(f => INFERNO_PATTERNS.some(fn => fn(f)));

if (changedCode && !changedInferno) {
  console.error("\n[inferno doc-gate] ✘ Code changed but inferno/ was NOT updated.");
  console.error("Update at least one file in inferno/ before pushing.\n");
  process.exit(1);
}
console.log("[inferno doc-gate] ✔ OK");

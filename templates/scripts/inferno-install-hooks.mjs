#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";

const cwd = process.cwd();
const gitDir = path.join(cwd, ".git");
const hooksDir = path.join(gitDir, "hooks");

if (!fs.existsSync(gitDir)) {
  console.error("[inferno hooks] .git not found. Run inside a git repository.");
  process.exit(1);
}

fs.mkdirSync(hooksDir, { recursive: true });

// Uses the global `infernoflow` (npm i -g infernoflow); skipped if it isn't installed.
const preCommit = `#!/bin/sh
command -v infernoflow >/dev/null 2>&1 || exit 0
echo "[inferno hooks] pre-commit: infernoflow check --strict"
infernoflow check --strict
`;

const prePush = `#!/bin/sh
command -v infernoflow >/dev/null 2>&1 || exit 0
echo "[inferno hooks] pre-push: infernoflow check --strict"
infernoflow check --strict
`;

const writeHook = (name, content) => {
  const filePath = path.join(hooksDir, name);
  fs.writeFileSync(filePath, content, "utf8");
  fs.chmodSync(filePath, 0o755);
  console.log(`[inferno hooks] installed ${name}`);
};

writeHook("pre-commit", preCommit);
writeHook("pre-push", prePush);
console.log("[inferno hooks] done");


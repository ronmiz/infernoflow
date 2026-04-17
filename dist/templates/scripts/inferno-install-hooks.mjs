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

const preCommit = `#!/bin/sh
echo "[inferno hooks] pre-commit: infernoflow run --provider auto --dry-run"
npx infernoflow run "sync check" --provider auto --dry-run
`;

const prePush = `#!/bin/sh
echo "[inferno hooks] pre-push: infernoflow run --provider auto --json"
npx infernoflow run "sync check" --provider auto --json
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


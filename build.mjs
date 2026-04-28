#!/usr/bin/env node
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");

// On Windows-mounted filesystems rmSync can fail with EPERM — skip the clean and let esbuild overwrite in place.
if (fs.existsSync(DIST)) { try { fs.rmSync(DIST, { recursive: true }); } catch { /* overwrite in place */ } }
fs.mkdirSync(DIST, { recursive: true });

function collectMjs(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMjs(full, results);
    else if (entry.name.endsWith(".mjs")) results.push(full);
  }
  return results;
}

const allFiles = [...collectMjs(path.join(ROOT, "bin")), ...collectMjs(path.join(ROOT, "lib"))];
console.log(`\n?? infernoflow build\n${"-".repeat(40)}`);
console.log(`  Minifying ${allFiles.length} files ? dist/\n`);

await build({
  entryPoints: allFiles,
  outbase: ROOT,
  outdir: DIST,
  format: "esm",
  platform: "node",
  target: "node18",
  minify: true,
  bundle: false,
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
});

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyDir(path.join(ROOT, "templates"), path.join(DIST, "templates"));
fs.copyFileSync(path.join(ROOT, "package.json"), path.join(DIST, "package.json"));
const distFiles = collectMjs(DIST);
console.log(`  ? ${distFiles.length} files in dist/`);
console.log(`  ? Ready to publish\n`);

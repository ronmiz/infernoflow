/**
 * infernoflow monorepo
 *
 * Monorepo-aware capability tracking. Detects packages in a monorepo
 * (nx, turborepo, pnpm workspaces, yarn workspaces, Lerna) and manages
 * per-package contracts.
 *
 * Sub-commands:
 *   monorepo init              Detect packages, scaffold inferno/ per package
 *   monorepo list              List all detected packages + contract status
 *   monorepo status            Show health across all packages at once
 *   monorepo diff [--package]  Diff capabilities for one or all packages
 *   monorepo sync              Sync all package contracts to root summary
 *
 * Usage:
 *   infernoflow monorepo init
 *   infernoflow monorepo list
 *   infernoflow monorepo status
 *   infernoflow monorepo diff --package auth
 *   infernoflow monorepo sync
 *   infernoflow monorepo status --json
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { header, ok, warn, info, done, bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── Package detection ─────────────────────────────────────────────────────────

function detectWorkspaceType(cwd) {
  const has = (f) => fs.existsSync(path.join(cwd, f));

  if (has("nx.json"))          return "nx";
  if (has("turbo.json"))       return "turborepo";
  if (has("lerna.json"))       return "lerna";
  if (has("pnpm-workspace.yaml")) return "pnpm";

  const pkg = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")); }
    catch { return {}; }
  })();

  if (pkg.workspaces) return Array.isArray(pkg.workspaces) ? "yarn" : "npm-workspaces";
  return null;
}

function readWorkspaceGlobs(cwd, wsType) {
  try {
    if (wsType === "pnpm") {
      const raw = fs.readFileSync(path.join(cwd, "pnpm-workspace.yaml"), "utf8");
      const matches = [...raw.matchAll(/^\s*-\s*['"]?([^'"]+)['"]?/gm)];
      return matches.map(m => m[1].trim());
    }
    if (wsType === "lerna") {
      const cfg = JSON.parse(fs.readFileSync(path.join(cwd, "lerna.json"), "utf8"));
      return cfg.packages || ["packages/*"];
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    const ws  = pkg.workspaces;
    if (Array.isArray(ws)) return ws;
    if (ws?.packages) return ws.packages;
  } catch {}
  return ["packages/*", "apps/*", "libs/*"];
}

function globToPackages(cwd, globs) {
  const packages = [];
  for (const pattern of globs) {
    // Simple glob: handle "packages/*" and "apps/*" patterns
    const parts  = pattern.split("/");
    const parent = parts.slice(0, -1).join("/");
    const leaf   = parts[parts.length - 1];
    const dir    = path.join(cwd, parent);

    if (!fs.existsSync(dir)) continue;
    if (leaf === "*") {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const pkgPath = path.join(dir, entry.name, "package.json");
            if (fs.existsSync(pkgPath)) {
              const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
              packages.push({
                name:    pkg.name || entry.name,
                dir:     path.join(dir, entry.name),
                version: pkg.version || "0.0.0",
              });
            }
          }
        }
      } catch {}
    } else {
      const fullDir = path.join(cwd, pattern);
      const pkgPath = path.join(fullDir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        packages.push({ name: pkg.name || leaf, dir: fullDir, version: pkg.version || "0.0.0" });
      }
    }
  }
  return packages;
}

function detectPackages(cwd) {
  const wsType = detectWorkspaceType(cwd);
  if (!wsType) return { type: null, packages: [] };
  const globs    = readWorkspaceGlobs(cwd, wsType);
  const packages = globToPackages(cwd, globs);
  return { type: wsType, packages };
}

// ── Contract helpers ──────────────────────────────────────────────────────────

function readPackageContract(pkgDir) {
  for (const f of ["contract.json", "capabilities.json"]) {
    const p = path.join(pkgDir, "inferno", f);
    if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch {} }
  }
  return null;
}

function hasInferno(pkgDir) {
  return fs.existsSync(path.join(pkgDir, "inferno"));
}

function contractStatus(pkgDir) {
  if (!hasInferno(pkgDir)) return "not-init";
  const contract = readPackageContract(pkgDir);
  if (!contract) return "no-contract";
  return "ok";
}

// ── CLI runner ────────────────────────────────────────────────────────────────

function runInferno(args, cwd) {
  const binPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "..", "bin", "infernoflow.mjs");
  const result  = spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout:  60_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: result.stdout || "", stderr: result.stderr || "", status: result.status };
}

// ── Sub-commands ──────────────────────────────────────────────────────────────

async function subcmdInit(args, cwd) {
  const jsonMode = args.includes("--json");
  const force    = args.includes("--force") || args.includes("-f");
  const autoYes  = args.includes("--yes") || args.includes("-y");

  const { type, packages } = detectPackages(cwd);

  if (!type) {
    const msg = "No monorepo configuration detected. Supported: nx, turborepo, pnpm workspaces, yarn workspaces, lerna.";
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: msg })); } else { warn(msg); }
    process.exit(1);
  }

  if (!jsonMode) {
    header(`Monorepo init (${type})`);
    console.log(`  Detected ${bold(String(packages.length))} packages:\n`);
    packages.forEach(p => {
      const status = contractStatus(p.dir);
      const icon   = status === "ok" ? green("✔") : yellow("·");
      console.log(`  ${icon}  ${bold(p.name)}  ${gray(path.relative(cwd, p.dir))}`);
    });
    console.log();
  }

  if (packages.length === 0) {
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: "No packages found" })); }
    else { warn("No packages found matching workspace globs."); }
    process.exit(1);
  }

  const results = [];
  for (const pkg of packages) {
    const status = contractStatus(pkg.dir);
    if (status === "ok" && !force) {
      if (!jsonMode) info(`${pkg.name}: already initialised (use --force to reinit)`);
      results.push({ name: pkg.name, status: "skipped" });
      continue;
    }

    if (!jsonMode) process.stdout.write(`  Initialising ${cyan(pkg.name)}… `);

    const initArgs = ["init", "--adopt", "--yes"];
    if (force) initArgs.push("--force");
    const r = runInferno(initArgs, pkg.dir);

    if (r.status === 0) {
      if (!jsonMode) console.log(green("done"));
      results.push({ name: pkg.name, status: "ok" });
    } else {
      if (!jsonMode) console.log(red("failed"));
      results.push({ name: pkg.name, status: "error", error: r.stderr.trim().slice(0, 120) });
    }
  }

  // Write root summary
  const summary = {
    monorepoType: type,
    packages: results,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(cwd, "inferno-monorepo.json"), JSON.stringify(summary, null, 2) + "\n");

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, type, packages: results }));
  } else {
    console.log();
    const succeeded = results.filter(r => r.status === "ok").length;
    done(`Initialised ${bold(String(succeeded))} of ${results.length} packages`);
    console.log(`  ${gray("Root summary:")} ${cyan("inferno-monorepo.json")}`);
    console.log();
  }
}

async function subcmdList(args, cwd) {
  const jsonMode = args.includes("--json");
  const { type, packages } = detectPackages(cwd);

  if (!type && packages.length === 0) {
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: "No monorepo detected" })); }
    else { warn("No monorepo detected. Run: infernoflow monorepo init"); }
    return;
  }

  const rows = packages.map(p => ({
    name:    p.name,
    dir:     path.relative(cwd, p.dir),
    version: p.version,
    status:  contractStatus(p.dir),
    caps:    (() => {
      const c = readPackageContract(p.dir);
      return c ? (c.capabilities || []).length : 0;
    })(),
  }));

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, type, packages: rows }));
    return;
  }

  console.log();
  console.log(`  ${bold("Monorepo packages")}  ${gray("(" + type + ")")}`);
  console.log();
  const w = Math.max(...rows.map(r => r.name.length), 8) + 2;
  rows.forEach(r => {
    const icon = r.status === "ok" ? green("✔") : r.status === "not-init" ? yellow("○") : red("✗");
    const caps = r.status === "ok" ? gray(`${r.caps} caps`) : gray(r.status);
    console.log(`  ${icon}  ${r.name.padEnd(w)}${r.version.padEnd(12)}${caps}`);
  });
  console.log();
}

async function subcmdStatus(args, cwd) {
  const jsonMode = args.includes("--json");
  const { type, packages } = detectPackages(cwd);

  if (!packages.length) {
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: "No packages found" })); }
    else { warn("No packages found."); }
    return;
  }

  if (!jsonMode) header(`Monorepo status (${packages.length} packages)`);

  const results = [];
  for (const pkg of packages) {
    if (!hasInferno(pkg.dir)) {
      results.push({ name: pkg.name, status: "not-init", caps: 0 });
      if (!jsonMode) console.log(`  ${yellow("○")}  ${bold(pkg.name)}  ${gray("not initialised")}`);
      continue;
    }
    const r = runInferno(["status", "--json"], pkg.dir);
    try {
      const data = JSON.parse(r.stdout.trim());
      const caps = (data.capabilityDetails || []).length;
      const ok_  = data.ok !== false;
      results.push({ name: pkg.name, status: ok_ ? "ok" : "error", caps, version: data.policyVersion });
      if (!jsonMode) {
        const icon = ok_ ? green("✔") : red("✗");
        console.log(`  ${icon}  ${bold(pkg.name.padEnd(28))}${gray("v" + (data.policyVersion || "?"))}  ${caps} caps`);
      }
    } catch {
      results.push({ name: pkg.name, status: "error", caps: 0, error: "status failed" });
      if (!jsonMode) console.log(`  ${red("✗")}  ${bold(pkg.name)}  ${gray("status check failed")}`);
    }
  }

  if (jsonMode) {
    const allOk = results.every(r => r.status === "ok");
    console.log(JSON.stringify({ ok: allOk, type, packages: results }));
  } else {
    console.log();
    const ok_ = results.filter(r => r.status === "ok").length;
    console.log(`  ${ok_ === results.length ? green("✔") : yellow("⚠")}  ${ok_}/${results.length} packages healthy`);
    console.log();
  }
}

async function subcmdDiff(args, cwd) {
  const jsonMode   = args.includes("--json");
  const pkgFilter  = args.includes("--package") ? args[args.indexOf("--package") + 1] : null;
  const { packages } = detectPackages(cwd);

  const targets = pkgFilter
    ? packages.filter(p => p.name === pkgFilter || p.name.endsWith("/" + pkgFilter))
    : packages.filter(p => hasInferno(p.dir));

  if (!targets.length) {
    if (jsonMode) { console.log(JSON.stringify({ ok: false, error: pkgFilter ? `Package not found: ${pkgFilter}` : "No initialised packages found" })); }
    else { warn(pkgFilter ? `Package not found: ${pkgFilter}` : "No initialised packages found."); }
    return;
  }

  if (!jsonMode && !pkgFilter) header(`Monorepo diff (${targets.length} packages)`);

  const allResults = [];
  for (const pkg of targets) {
    const r = runInferno(["diff", "--json"], pkg.dir);
    try {
      const data    = JSON.parse(r.stdout.trim());
      const added   = (data.added   || []).length;
      const removed = (data.removed || []).length;
      const changed = (data.changed || []).length;
      allResults.push({ name: pkg.name, added, removed, changed, data });
      if (!jsonMode) {
        if (added || removed || changed) {
          console.log(`  ${bold(pkg.name)}`);
          if (added)   console.log(`    ${green("+")} ${added} added`);
          if (removed) console.log(`    ${red("-")} ${removed} removed`);
          if (changed) console.log(`    ${yellow("~")} ${changed} changed`);
        } else {
          console.log(`  ${green("✔")}  ${bold(pkg.name)}  ${gray("no changes")}`);
        }
      }
    } catch {
      allResults.push({ name: pkg.name, error: "diff failed" });
      if (!jsonMode) console.log(`  ${red("✗")}  ${bold(pkg.name)}  ${gray("diff failed")}`);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, packages: allResults }));
  } else {
    console.log();
  }
}

async function subcmdSync(args, cwd) {
  const jsonMode = args.includes("--json");
  const { type, packages } = detectPackages(cwd);

  if (!jsonMode) header("Syncing monorepo contracts");

  // Build a root aggregate contract
  const aggregate = {
    monorepoType: type,
    updatedAt:    new Date().toISOString(),
    packages:     [],
  };

  for (const pkg of packages) {
    const contract = readPackageContract(pkg.dir);
    if (!contract) continue;
    aggregate.packages.push({
      name:         pkg.name,
      version:      contract.policyVersion || pkg.version,
      capabilities: (contract.capabilities || []).map(c => typeof c === "string" ? c : c.id),
      capsCount:    (contract.capabilities || []).length,
    });
    if (!jsonMode) console.log(`  ${green("✔")}  ${bold(pkg.name)}  ${gray((contract.capabilities || []).length + " caps")}`);
  }

  const outPath = path.join(cwd, "inferno-monorepo.json");
  fs.writeFileSync(outPath, JSON.stringify(aggregate, null, 2) + "\n");

  const totalCaps = aggregate.packages.reduce((sum, p) => sum + p.capsCount, 0);

  if (jsonMode) {
    console.log(JSON.stringify({ ok: true, packages: aggregate.packages.length, totalCaps }));
  } else {
    console.log();
    done(`Synced ${bold(String(aggregate.packages.length))} packages (${totalCaps} total capabilities)`);
    console.log(`  ${cyan(outPath)}`);
    console.log();
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────

export async function monorepoCommand(rawArgs) {
  const args   = rawArgs.slice(1);
  const subcmd = args[0];
  const cwd    = process.cwd();
  const rest   = args.slice(1);

  switch (subcmd) {
    case "init":    return subcmdInit(rest, cwd);
    case "list":    return subcmdList(rest, cwd);
    case "status":  return subcmdStatus(rest, cwd);
    case "diff":    return subcmdDiff(rest, cwd);
    case "sync":    return subcmdSync(rest, cwd);
    default: {
      const jsonMode = args.includes("--json");
      const msg = `Unknown monorepo sub-command: ${subcmd || "(none)"}`;
      if (jsonMode) { console.log(JSON.stringify({ ok: false, error: msg })); return; }
      console.log();
      console.log(`  ${bold("infernoflow monorepo")} — per-package capability tracking`);
      console.log();
      console.log(`  ${cyan("infernoflow monorepo init")}      Scaffold inferno/ in each package`);
      console.log(`  ${cyan("infernoflow monorepo list")}      List packages and contract status`);
      console.log(`  ${cyan("infernoflow monorepo status")}    Health check across all packages`);
      console.log(`  ${cyan("infernoflow monorepo diff")}      Capability diff for all packages`);
      console.log(`  ${cyan("infernoflow monorepo diff --package auth")}  Diff a specific package`);
      console.log(`  ${cyan("infernoflow monorepo sync")}      Aggregate all contracts to inferno-monorepo.json`);
      console.log();
      console.log(`  ${gray("Supported: nx, turborepo, pnpm workspaces, yarn workspaces, lerna")}`);
      console.log();
    }
  }
}

import * as fs from "node:fs";
import * as path from "node:path";
import { header, ok, fail, warn, section, bold, cyan, yellow, gray, green, red, white } from "../ui/output.mjs";
import { ampPaths } from "../amp/io.mjs";

function timeAgo(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function getCoverage(scenariosDir, caps) {
  const covered = new Set();
  if (fs.existsSync(scenariosDir)) {
    for (const f of fs.readdirSync(scenariosDir).filter(f => f.endsWith(".json"))) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
        (s.capabilitiesCovered || []).forEach(c => covered.add(c));
      } catch {}
    }
  }
  return { covered: caps.filter(c => covered.has(c)), uncovered: caps.filter(c => !covered.has(c)) };
}

export async function statusCommand(args = []) {
  const asJson = args.includes("--json");
  const cwd = process.cwd();
  const infernoDir = path.join(cwd, "inferno");
  const ampDir     = path.join(cwd, ".ai-memory");
  if (!asJson) {
    header("status");
  }

  // Accept either layout — .ai-memory/ (AMP) or inferno/ (legacy)
  if (!fs.existsSync(infernoDir) && !fs.existsSync(ampDir)) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: "not_initialized", hint: "Run: infernoflow init" }, null, 2));
      process.exit(1);
    }
    fail("not initialized — neither .ai-memory/ nor inferno/ found", `Run: infernoflow init`);
    console.log();
    process.exit(1);
  }

  // ── Memory-mode short-circuit ───────────────────────────────────────────
  // When `init` ran in memory mode (the default since v0.37.0), there's no
  // contract.json by design. Show session-memory health instead of treating
  // the absent contract as an error.
  const ampConfigPath    = path.join(ampDir, "amp.json");
  const legacyConfigPath = path.join(infernoDir, "config.json");
  const contractPath     = path.join(infernoDir, "contract.json");
  // Memory-mode signal: an amp.json exists (always memory mode for AMP layout),
  // or legacy config.json says mode=memory, or no contract.json is present.
  const isAmpLayout      = fs.existsSync(ampConfigPath) || fs.existsSync(ampDir);
  const legacyMode = (() => {
    try { return JSON.parse(fs.readFileSync(legacyConfigPath, "utf8")).mode || null; } catch { return null; }
  })();
  const isMemoryMode = isAmpLayout
                    || legacyMode === "memory"
                    || (!fs.existsSync(contractPath) && fs.existsSync(legacyConfigPath));

  if (isMemoryMode) {
    const sessionsPath = ampPaths(cwd).sessions;
    const entries = (() => {
      if (!fs.existsSync(sessionsPath)) return [];
      return fs.readFileSync(sessionsPath, "utf8").split("\n").filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    })();
    const gotchas    = entries.filter(e => e.type === "gotcha").length;
    const decisions  = entries.filter(e => e.type === "decision").length;
    const attempts   = entries.filter(e => e.type === "attempt").length;
    const lastEntry  = entries[entries.length - 1];

    if (asJson) {
      console.log(JSON.stringify({
        ok: true,
        mode: "memory",
        entries: entries.length,
        gotchas, decisions, attempts,
        lastEntry: lastEntry ? lastEntry.ts : null,
      }, null, 2));
      return;
    }

    section("Session memory");
    console.log(`  ${gray("entries")}      ${bold(String(entries.length))}`);
    console.log(`  ${gray("gotchas")}      ${bold(String(gotchas))}`);
    console.log(`  ${gray("decisions")}    ${bold(String(decisions))}`);
    console.log(`  ${gray("attempts")}     ${bold(String(attempts))}`);
    if (lastEntry) {
      console.log(`  ${gray("last entry")}   ${gray(timeAgo(new Date(lastEntry.ts).getTime()))}`);
    }
    console.log();
    if (entries.length === 0) {
      console.log(`  ${yellow("●")} ${bold(yellow("empty"))} ${gray("— log your first gotcha:")} ${cyan("infernoflow log \"...\" --type gotcha")}`);
    } else {
      console.log(`  ${green("●")} ${bold(green("ready"))} ${gray("— run")} ${cyan("infernoflow recap")} ${gray("for the full session summary")}`);
    }
    console.log(`\n  ${gray("Want capability contracts + CI gates? Run:")} ${cyan("infernoflow init --mode full")}\n`);
    return;
  }

  if (!fs.existsSync(contractPath)) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: "contract_not_found" }, null, 2));
      process.exit(1);
    }
    fail("contract.json not found");
    console.log();
    process.exit(1);
  }

  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const caps = contract.capabilities || [];
  const stat = fs.statSync(contractPath);
  const scenariosDir = path.join(infernoDir, "scenarios");
  const changelogPath = path.join(infernoDir, "CHANGELOG.md");
  const capsPath = path.join(infernoDir, "capabilities.json");
  const { covered, uncovered } = getCoverage(scenariosDir, caps);

  const hasChangelog = fs.existsSync(changelogPath) && /##\s+Unreleased/i.test(fs.readFileSync(changelogPath, "utf8"));
  const driftReasons = [];
  if (uncovered.length > 0) driftReasons.push(`${uncovered.length} capabilities without scenario coverage`);
  if (!hasChangelog) driftReasons.push("CHANGELOG missing ## Unreleased section");
  const allGood = driftReasons.length === 0;

  if (asJson) {
    const payload = {
      ok: allGood,
      driftReasons,
      project: {
        policyId: contract.policyId || null,
        policyVersion: contract.policyVersion || null,
        lastChange: timeAgo(stat.mtimeMs),
      },
      capabilities: {
        total: caps.length,
        uncovered,
      },
      changelog: {
        hasUnreleased: hasChangelog,
      },
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(allGood ? 0 : 1);
  }

  if (!allGood) {
    section("Drift");
    driftReasons.forEach((reason) => console.log(`  ${yellow("⚠")} ${reason}`));
  }

  // ── Project ─────────────────────────────────────────────────────
  section("Project");
  console.log(`  ${gray("policy")}       ${bold(contract.policyId || "—")}`);
  console.log(`  ${gray("version")}      ${bold("v" + (contract.policyVersion || "?"))}`);
  console.log(`  ${gray("last change")}  ${gray(timeAgo(stat.mtimeMs))}`);

  // ── Capabilities ─────────────────────────────────────────────────
  section(`Capabilities  ${gray("(" + caps.length + ")")}`);

  let capsRegistry = {};
  if (fs.existsSync(capsPath)) {
    try {
      const reg = JSON.parse(fs.readFileSync(capsPath, "utf8"));
      (reg.capabilities || []).forEach(c => { capsRegistry[c.id] = c; });
    } catch {}
  }

  caps.forEach(cap => {
    const reg = capsRegistry[cap];
    const hasCoverage = covered.includes(cap);
    const icon = hasCoverage ? green("✔") : red("✘");
    const title = reg?.title ? gray(` — ${reg.title}`) : "";
    const since = reg?.since ? gray(` [${reg.since}]`) : "";
    console.log(`  ${icon} ${white(cap)}${title}${since}`);
  });

  if (uncovered.length > 0) {
    console.log(`\n  ${yellow("⚠")}  ${uncovered.length} capability(ies) lack scenario coverage`);
  } else {
    console.log(`\n  ${green("✔")}  All capabilities have scenario coverage`);
  }

  // ── Scenarios ─────────────────────────────────────────────────────
  section("Scenarios");
  if (fs.existsSync(scenariosDir)) {
    const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith(".json"));
    if (files.length === 0) {
      warn("No scenario files — add .json files to inferno/scenarios/");
    } else {
      files.forEach(f => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
          const steps = s.steps?.length || 0;
          const capCount = (s.capabilitiesCovered || []).length;
          console.log(`  ${green("✔")} ${cyan(f)} ${gray(`— ${steps} steps, ${capCount} caps covered`)}`);
        } catch {
          console.log(`  ${red("✘")} ${cyan(f)} ${gray("— invalid JSON")}`);
        }
      });
    }
  } else {
    warn("scenarios/ directory not found");
  }

  // ── Changelog ─────────────────────────────────────────────────────
  section("Changelog");
  if (fs.existsSync(changelogPath)) {
    const txt = fs.readFileSync(changelogPath, "utf8");
    if (/##\s+Unreleased/i.test(txt)) {
      ok("Has ## Unreleased section");
    } else {
      fail("Missing ## Unreleased section");
    }
    const sections = txt.split("\n").filter(l => /^##\s/.test(l)).slice(0, 3);
    sections.forEach(l => console.log(`  ${gray(l)}`));
  } else {
    fail("inferno/CHANGELOG.md not found");
  }

  // ── Health ────────────────────────────────────────────────────────
  console.log();
  if (allGood) {
    console.log(`  ${green("●")} ${bold(green("ready"))} ${gray("— run infernoflow check for full validation")}`);
  } else {
    console.log(`  ${yellow("●")} ${bold(yellow("needs attention"))} ${gray("— run infernoflow check for details")}`);
  }
  console.log();
}

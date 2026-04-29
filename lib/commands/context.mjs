import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { bold, gray, cyan, red, green, yellow } from "../ui/output.mjs";
import { buildCursorImplementPrompt, buildGenericImplementPrompt } from "../ui/prompts.mjs";
import { detectDrift } from "../git/detect-drift.mjs";

function copyToClipboard(text) {
  try {
    const p = process.platform;
    if (p === "win32") execSync("clip", { input: text });
    else if (p === "darwin") execSync("pbcopy", { input: text });
    else { try { execSync("xclip -selection clipboard", { input: text }); } catch { execSync("xsel --clipboard --input", { input: text }); } }
    return true;
  } catch { return false; }
}

const INFERNO_DIR = "inferno";
const CONTEXT_FILE = path.join(INFERNO_DIR, "CONTEXT.md");
const STATE_FILE  = path.join(INFERNO_DIR, "context-state.json");

function readJSON(f) { try { return JSON.parse(fs.readFileSync(f,"utf8")); } catch { return null; } }
function readFile(f) { try { return fs.readFileSync(f,"utf8"); } catch { return null; } }
function loadState() { const r=readFile(STATE_FILE); if(!r) return {}; try { return JSON.parse(r); } catch { return {}; } }
function saveState(s) { fs.writeFileSync(STATE_FILE,JSON.stringify(s,null,2),"utf8"); }
function fmtDate(iso) { if(!iso) return "unknown"; return new Date(iso).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"}); }
function parseChangelog(txt,max) {
  if(!txt) return [];
  const entries=[]; let cur=null;
  for(const line of txt.split("\n")) {
    if(line.startsWith("## ")) { if(cur&&entries.length<max) entries.push(cur); if(entries.length>=max) break; cur={title:line.replace("## ","").trim(),items:[]}; }
    else if(cur&&line.startsWith("- ")) cur.items.push(line.replace("- ","").trim());
  }
  if(cur&&entries.length<max) entries.push(cur);
  return entries.filter(e=>e.items.length>0);
}

export async function contextCommand(args) {
  const has  = (f) => args.includes(f);
  const flag = (f) => { const i=args.indexOf(f); return i!==-1&&args[i+1]?args[i+1]:null; };

  const intent   = flag("--intent")   || flag("-i");
  const working  = flag("--working")  || flag("-w");
  const decision = flag("--decision") || flag("-d");
  const showOnly = has("--show")  || has("-s");
  const copyFlag = has("--copy")  || has("-c");
  const cursorFlag  = has("--cursor");
  const copilotFlag = has("--copilot");
  const resetFlag= has("--reset");
  const watchFlag      = has("--watch");
  const autoCommit     = has("--auto-commit") || has("--auto-push");
  const autoPush       = has("--auto-push");
  const watchInterval  = parseInt(flag("--interval") || "30", 10) * 1000;

  console.log("\n  "+bold("��� infernoflow — context"));
  console.log("  "+"─".repeat(50)+"\n");

  if(!fs.existsSync(INFERNO_DIR)){
    console.error(red("  ✘ inferno/ not found"));
    console.error(gray("  → Run: infernoflow init\n"));
    process.exit(1);
  }

  const contract     = readJSON(path.join(INFERNO_DIR,"contract.json"));
  const capabilities = readJSON(path.join(INFERNO_DIR,"capabilities.json"));
  const changelog    = readFile(path.join(INFERNO_DIR,"CHANGELOG.md"));

  if(!contract||!capabilities){
    console.error(red("  ✘ Missing contract.json or capabilities.json\n"));
    process.exit(1);
  }

  let state = loadState();
  if(resetFlag){ state={}; console.log(yellow("  ⚠ State reset\n")); }
  if(intent)   { state.intent=intent; state.intentUpdated=new Date().toISOString(); console.log(green('  ✔ Intent saved: "'+intent+'"')); }
  if(working)  { state.working=working; state.workingUpdated=new Date().toISOString(); console.log(green('  ✔ Working on: "'+working+'"')); }
  if(decision) { if(!state.decisions) state.decisions=[]; state.decisions.push({text:decision,date:new Date().toISOString()}); console.log(green('  ✔ Decision recorded: "'+decision+'"')); }
  if(intent||working||decision) saveState(state);

  const capList   = capabilities.capabilities||[];
  const allInSync = capList.length===(contract.capabilities||[]).length;
  const recent    = parseChangelog(changelog,3);
  const version   = String(contract.policyVersion).replace(/^v/i,"");
  const now       = new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
  const syncBadge = allInSync?"✓ validated":"⚠ out of sync";
  const implementTask = state.intent || "describe the exact task to implement";
  const implementInput = { task: implementTask, contract, caps: capabilities, scenarios: [], state };
  const cursorPrompt = buildCursorImplementPrompt(implementInput);
  const genericPrompt = buildGenericImplementPrompt(implementInput);

  const capLines  = capList.map(c=>"- **"+c.id+"** — "+c.title).join("\n");
  const chgLines  = recent.length>0 ? recent.map(e=>"### "+e.title+"\n"+e.items.map(i=>"  - "+i).join("\n")).join("\n\n") : "_No recent changes_";
  const intentLine  = state.intent   ? state.intent+"  _("+fmtDate(state.intentUpdated)+")_"  : "_Not set — run: infernoflow context --intent \"...\"_";
  const workingLine = state.working  ? state.working+"  _("+fmtDate(state.workingUpdated)+")_" : "_Not set — run: infernoflow context --working \"...\"_";
  const decLines    = state.decisions&&state.decisions.length>0 ? state.decisions.slice(-5).map(d=>"- "+d.text+"  _("+fmtDate(d.date)+")_").join("\n") : "_No decisions recorded_";

  const md = [
    "# Project Context — "+contract.policyId+" v"+version,
    "> Generated by infernoflow | "+now+" | "+syncBadge,
    "","---","",
    "## What this system does","",capLines,"","---","",
    "## Recent changes","",chgLines,"","---","",
    "## Current state","",
    "- **Capabilities:** "+capList.length,
    "- **Version:** v"+version,
    "- **Sync:** "+syncBadge,
    "","---","",
    "## What I am working on right now","",workingLine,"","---","",
    "## Intent — what I want to build next","",intentLine,"","---","",
    "## Decisions & notes","",decLines,"","---",
    "",
    "## Implementation Prompt Seed","",
    "Use this to start coding immediately with an agent:","",
    "```bash",
    `infernoflow implement "${implementTask}" --mode both`,
    "```",
    "",
    "### Cursor Agent Prompt","",
    "```text",
    cursorPrompt,
    "```",
    "",
    "### Generic Agent Prompt","",
    "```text",
    genericPrompt,
    "```",
    "",
    "---",
    "_Paste this block at the start of any new AI session._"
  ].join("\n");

  if(!showOnly){ fs.writeFileSync(CONTEXT_FILE,md,"utf8"); console.log(green("\n  ✔ Context written → "+CONTEXT_FILE)); }

  if(copyFlag){
    const ok=copyToClipboard(md);
    console.log(ok ? green("  ✔ Copied to clipboard — paste with Ctrl+V") : yellow("  ⚠ Clipboard copy failed — open inferno/CONTEXT.md manually"));
  }

  if (cursorFlag) {
    fs.writeFileSync(".cursorrules", md, "utf8");
    console.log(green("  ✔ Written to .cursorrules — Cursor loads this automatically"));
  }
  if (copilotFlag) {
    if (!fs.existsSync(".github")) fs.mkdirSync(".github");
    fs.writeFileSync(".github/copilot-instructions.md", md, "utf8");
    console.log(green("  ✔ Written to .github/copilot-instructions.md — Copilot loads this automatically"));
  }
  console.log("\n  "+bold("Context Summary"));
  console.log("  "+"─".repeat(50));
  console.log("  Project      "+contract.policyId+" — v"+version);
  console.log("  Capabilities "+capList.length+" registered");
  console.log("  Sync         "+(allInSync?green("✓ in sync"):yellow("⚠ check needed")));
  console.log("  Working on   "+(state.working?cyan(state.working):gray("not set")));
  console.log("  Intent       "+(state.intent ?cyan(state.intent) :gray("not set")));
  console.log("  Decisions    "+(state.decisions?state.decisions.length:0)+" recorded\n");
  console.log("  "+bold("Implementation Prompt"));
  console.log("  "+cyan("→")+" Run "+cyan(`infernoflow implement "${implementTask}" --mode both`)+"\n");

  if(copyFlag){
    console.log("  "+bold("Ready to use:"));
    console.log("  "+cyan("→")+" Paste into Claude / Cursor / Copilot with "+cyan("Ctrl+V")+"\n");
  } else {
    console.log("  "+bold("Ready to use:"));
    console.log("  "+cyan("1.")+" Open "+cyan("inferno/CONTEXT.md"));
    console.log("  "+cyan("2.")+" Copy everything");
    console.log("  "+cyan("3.")+" Paste at the start of your next AI session");
    console.log("  "+gray("  tip: use --copy to skip steps 1-2 automatically")+"\n");
  }

  // ── Watch mode ────────────────────────────────────────────────────────────
  if (watchFlag) {
    const modeLabel = autoPush ? "auto-push" : autoCommit ? "auto-commit" : "watch";
    console.log("  " + cyan("👁  Watch mode active") + gray(
      ` — polling every ${watchInterval / 1000}s` +
      (autoPush ? " · will commit + push on change" : autoCommit ? " · will commit on change" : "")
    ));
    console.log("  " + gray("Press Ctrl+C to stop\n"));

    let lastChangedFiles = "";
    let lastCommittedContent = null;

    // ── git helpers ──────────────────────────────────────────────────────
    function gitRun(cmd) {
      try {
        execSync(cmd, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return true;
      } catch { return false; }
    }

    function gitIsCleanFor(filePath) {
      // Returns true if the file has no staged/unstaged changes (nothing to commit)
      try {
        const out = execSync(`git status --porcelain "${filePath}"`, {
          cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
        }).trim();
        return out === "";
      } catch { return true; }
    }

    function commitContext(contextPath, affectedCaps, changedCount) {
      const caps  = affectedCaps.length > 0 ? affectedCaps.slice(0, 3).join(", ") : `${changedCount} files`;
      const msg   = `chore: update context [${caps}]`;
      const staged = gitRun(`git add "${contextPath}"`);
      if (!staged) return { ok: false, reason: "git add failed" };
      if (gitIsCleanFor(contextPath)) return { ok: false, reason: "nothing to commit" };
      const committed = gitRun(`git commit -m "${msg}"`);
      if (!committed) return { ok: false, reason: "git commit failed (lock?)" };
      return { ok: true, msg };
    }

    function pushContext() {
      const ok = gitRun("git push");
      return ok;
    }

    // ── poll loop ────────────────────────────────────────────────────────
    const poll = async () => {
      try {
        const cwd = process.cwd();
        const drift = detectDrift(cwd, { sinceCommits: 1 });
        const changedKey = drift.changedFiles.sort().join("|");

        if (changedKey === lastChangedFiles) return;
        lastChangedFiles = changedKey;
        if (drift.changedFiles.length === 0) return;

        // Update "working" field
        const affected = drift.affectedCapabilities.map(c => c.id);
        const newWorking = affected.length > 0
          ? `Working on: ${affected.join(", ")} (${drift.changedFiles.length} files changed)`
          : `${drift.changedFiles.length} files changed — no capability match yet`;

        const currentState = loadState();
        if (currentState.working !== newWorking) {
          currentState.working = newWorking;
          currentState.workingUpdated = new Date().toISOString();
          saveState(currentState);

          // Regenerate CONTEXT.md silently
          await contextCommand(args.filter(a => a !== "--watch" && a !== "--auto-commit" && a !== "--auto-push"));

          const newContent = readFile(CONTEXT_FILE);
          const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

          process.stderr.write(
            `\n  ${green("✔")} [${ts}] Context updated — ${affected.length} capabilities affected\n` +
            `  ${gray(drift.changedFiles.slice(0, 3).join(", ") + (drift.changedFiles.length > 3 ? ` +${drift.changedFiles.length - 3} more` : ""))}\n`
          );

          // Auto-commit if enabled and content actually changed
          if (autoCommit && newContent !== lastCommittedContent) {
            lastCommittedContent = newContent;
            const result = commitContext(CONTEXT_FILE, affected, drift.changedFiles.length);
            if (result.ok) {
              process.stderr.write(`  ${green("✔")} Committed: ${gray(result.msg)}\n`);
              if (autoPush) {
                const pushed = pushContext();
                process.stderr.write(
                  pushed
                    ? `  ${green("✔")} Pushed to origin\n`
                    : `  ${yellow("⚠")} Push failed — will retry next change\n`
                );
              }
            } else {
              process.stderr.write(`  ${yellow("⚠")} Commit skipped: ${gray(result.reason)}\n`);
            }
          }
        }
      } catch {
        // Silent — watch mode never crashes
      }
    };

    // Poll immediately then on interval
    await poll();
    const timer = setInterval(poll, watchInterval);

    process.on("SIGINT", () => {
      clearInterval(timer);
      process.stderr.write("\n  " + gray("Watch stopped.\n\n"));
      process.exit(0);
    });

    // Prevent Node from exiting
    await new Promise(() => {});
  }
}

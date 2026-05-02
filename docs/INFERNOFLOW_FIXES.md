# 🔧 infernoflow — Exact Fixes & How To Implement

> Step-by-step instructions for Ron Miz to fix infernoflow v0.36.1
> Each fix includes: what's broken, where to fix it, exact code

---

## Fix #1: Windows PowerShell Unicode Rendering (P0)

### What's Broken
All box-drawing characters render as `ΓפאΓפא` garbage in Windows PowerShell.
This is the FIRST thing Windows users see. It looks broken.

### Where to Fix
The output formatting module — wherever `──────` and `│` characters are used.

### How to Fix

**Step 1:** Create a terminal detection utility:

```javascript
// src/utils/terminal.js (or wherever utils live)

function supportsUnicode() {
  // Windows PowerShell doesn't support unicode box drawing
  if (process.platform === 'win32') {
    // Windows Terminal and modern terminals set WT_SESSION
    if (process.env.WT_SESSION) return true;
    // ConEmu/Cmder
    if (process.env.ConEmuPID) return true;
    // VS Code integrated terminal
    if (process.env.TERM_PROGRAM === 'vscode') return true;
    // Default Windows cmd/PowerShell — no unicode
    return false;
  }
  return true; // Mac/Linux always support it
}

const CHARS = supportsUnicode()
  ? { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘', dot: '·', arrow: '→', check: '✔', cross: '✘', warn: '⚠' }
  : { h: '-', v: '|', tl: '+', tr: '+', bl: '+', br: '+', dot: '*', arrow: '->', check: '[OK]', cross: '[X]', warn: '[!]' };

export { supportsUnicode, CHARS };
```

**Step 2:** Replace all hardcoded unicode box characters with `CHARS.h`, `CHARS.v`, etc.

**Step 3:** Test by running in plain `powershell.exe` (not Windows Terminal).

### Quick Test
```powershell
# This should render cleanly after the fix:
infernoflow status
infernoflow recap
infernoflow health
```

---

## Fix #2: `@scarf/scarf` Install Failure on Windows (P0)

### What's Broken
```
npm install -g infernoflow
→ npm error command C:\windows\system32\cmd.exe /d /s /c 
  node -e "try{require('@scarf/scarf')}catch(e){}" 2>/dev/null
→ FAILS because 2>/dev/null is Linux syntax, not Windows
```

New users CANNOT install infernoflow on Windows. This is critical.

### Where to Fix
`package.json` in the infernoflow npm package — the `postinstall` script.

### How to Fix

**Option A (Best): Remove postinstall, use runtime analytics instead:**

```json
// package.json — REMOVE this:
"scripts": {
  "postinstall": "node -e \"try{require('@scarf/scarf')}catch(e){}\" 2>/dev/null; exit 0"
}

// Instead, add to the CLI entry point (bin/infernoflow.mjs or similar):
// At the very end of the main() function:
try { await import('@scarf/scarf'); } catch {}
```

**Option B (Quick): Fix the Windows redirect:**

```json
"scripts": {
  "postinstall": "node -e \"try{require('@scarf/scarf')}catch(e){}\" 2>&1 || true"
}
```

**Option C (Safest): Use cross-platform syntax:**

```json
"scripts": {
  "postinstall": "node scripts/postinstall.js"
}
```

```javascript
// scripts/postinstall.js
try { require('@scarf/scarf'); } catch (e) { /* silent */ }
```

### Quick Test
```powershell
npm uninstall -g infernoflow
npm install -g infernoflow
# Should install without errors
```

---

## Fix #3: Simplify `--help` Output (P1)

### What's Broken
`infernoflow --help` shows ALL commands. New user sees 50+ commands and gives up.

### Where to Fix
The help/CLI router module — likely `src/cli.js` or `src/index.js`.

### How to Fix

```javascript
// In the help command handler:

function showHelp() {
  console.log(`
  🔥 infernoflow v${version}
  Persistent memory for AI coding sessions

  Usage:
    infernoflow [command] [options]

  Core Commands:
    log "..."       Remember something (gotcha, decision, attempt, note)
    ask "..."       Search your memory
    switch          Generate handoff for next AI agent
    recap           Session summary + health score
    status          Quick health check

  Getting Started:
    setup           One command to get fully operational
    demo            Interactive walkthrough (5 minutes)
    doctor          Diagnose your setup

  Run infernoflow commands        to see all 50+ commands
  Run infernoflow <cmd> --help    for command-specific help
  `);
}
```

**Key:** The `infernoflow commands` output stays the same (full list). Only `--help` changes.

---

## Fix #4: New `init` Flow — 60 Second Magic Moment (P1)

### What's Broken
`infernoflow init` immediately creates contracts, capabilities, scenarios.
User doesn't understand what these are. Drops off.

### Where to Fix
`src/commands/init.js` (or wherever the init command lives).

### How to Fix

```javascript
// New init flow:

async function init(options) {
  const isFullMode = options.mode === 'full' || options.contracts;
  
  if (!isFullMode) {
    // DEFAULT: Simple session memory mode
    return await initSessionMemory();
  }
  
  // --mode full: existing contract init behavior
  return await initFull();
}

async function initSessionMemory() {
  // 1. Detect project
  const pkg = readPackageJson();
  const projectName = pkg?.name || path.basename(process.cwd());
  
  console.log(`\n  🔥 infernoflow — setting up session memory\n`);
  console.log(`  Detected: ${projectName}\n`);
  
  // 2. Create inferno/ directory
  ensureDir('inferno');
  
  // 3. Create minimal config
  writeJson('inferno/config.json', {
    project: projectName,
    version: '1',
    mode: 'memory',
    created: new Date().toISOString()
  });
  
  // 4. Create empty sessions.jsonl
  touchFile('inferno/sessions.jsonl');
  
  // 5. Ask for first gotcha
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  const gotcha = await new Promise(resolve => {
    rl.question('  What should the next AI agent know about this project?\n  > ', resolve);
  });
  rl.close();
  
  if (gotcha && gotcha.trim()) {
    appendSession({
      type: 'gotcha',
      msg: gotcha.trim(),
      ts: Date.now(),
      source: 'init'
    });
    console.log(`\n  ✅ First gotcha logged!\n`);
  }
  
  // 6. Show next steps
  console.log(`  You're set. Quick commands:`);
  console.log(`    infernoflow log "..."    — remember something`);
  console.log(`    infernoflow switch       — handoff for next AI`);
  console.log(`    infernoflow recap        — session summary\n`);
  console.log(`  Want contracts & CI gates? Run: infernoflow init --mode full\n`);
}
```

### The Key Insight
Default `init` should:
1. Take 30 seconds, not 5 minutes
2. Ask for ONE gotcha (immediate value)
3. Show only 3 next-step commands
4. Mention contracts as an upgrade, not the default

---

## Fix #5: Stunning `switch` Output (P1)

### What's Broken
Current handoff is functional but not impressive. Doesn't auto-detect hot files.
Doesn't make the AI agent's job easy.

### Where to Fix
`src/commands/switch.js` (or wherever switch/handoff is generated).

### How to Fix

Add these auto-detection features to the handoff generator:

```javascript
async function generateHandoff() {
  const sessions = readSessions();
  const gotchas = sessions.filter(e => e.type === 'gotcha');
  const decisions = sessions.filter(e => e.type === 'decision');
  const attempts = sessions.filter(e => e.type === 'attempt');
  const notes = sessions.filter(e => e.type === 'note');
  
  // AUTO-DETECT: Hot files from git
  const hotFiles = await getHotFiles(); // git log --stat for current session
  
  // AUTO-DETECT: What was being worked on
  const recentCommits = await getRecentCommits(5);
  const workingOn = inferWorkingOn(recentCommits, sessions);
  
  // Calculate health
  const { score, grade } = calculateHealth(sessions);
  
  // Build handoff
  let md = `# 🔥 Agent Handoff — ${projectName}\n`;
  md += `Session: ${sessionDuration} | Health: ${grade} (${score}/100) | ${sessions.length} entries\n\n`;
  
  // GOTCHAS FIRST — most valuable
  if (gotchas.length > 0) {
    md += `## ⚠️ STOP — Read These Before Doing Anything\n`;
    gotchas.forEach((g, i) => {
      md += `${i + 1}. **${g.msg}**\n`;
      if (g.file) md += `   → File: ${g.file}${g.line ? ':' + g.line : ''}\n`;
    });
    md += `\n`;
  }
  
  // FAILED ATTEMPTS — prevent repeats
  if (attempts.length > 0) {
    md += `## ❌ Already Tried (Don't Repeat)\n`;
    attempts.forEach((a, i) => {
      md += `${i + 1}. ${a.msg}\n`;
    });
    md += `\n`;
  }
  
  // DECISIONS — follow these
  if (decisions.length > 0) {
    md += `## ✓ Decisions In Effect\n`;
    decisions.forEach((d, i) => {
      md += `${i + 1}. ${d.msg}\n`;
    });
    md += `\n`;
  }
  
  // HOT FILES — auto-detected
  if (hotFiles.length > 0) {
    md += `## 📁 Hot Files This Session\n`;
    hotFiles.forEach(f => {
      md += `- \`${f.path}\` — ${f.changes} edits`;
      if (f.description) md += ` — ${f.description}`;
      md += `\n`;
    });
    md += `\n`;
  }
  
  // WHAT WAS BEING WORKED ON — auto-inferred
  if (workingOn) {
    md += `## 🎯 Current Task\n`;
    md += `${workingOn}\n\n`;
  }
  
  return md;
}

// Helper: Get most-edited files from git
async function getHotFiles() {
  try {
    const { stdout } = await exec('git diff --stat HEAD~10 HEAD 2>/dev/null || git diff --stat HEAD');
    return parseGitStat(stdout)
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 5);
  } catch {
    return [];
  }
}
```

### The Key Improvement
**Auto-detect "hot files" and "current task"** from git history. The user logs gotchas and decisions manually, but everything else is automatic.

---

## Fix #6: `switch --copy` Clipboard Support (P1)

### What's Broken
User has to: open file → select all → copy → paste into AI chat.
Should be one command.

### How to Fix

```javascript
// In switch command:
import { execSync } from 'child_process';

if (options.copy) {
  const handoff = generateHandoff();
  
  // Cross-platform clipboard
  if (process.platform === 'win32') {
    execSync('clip', { input: handoff });
  } else if (process.platform === 'darwin') {
    execSync('pbcopy', { input: handoff });
  } else {
    // Linux: try xclip, xsel, or wl-copy
    try {
      execSync('xclip -selection clipboard', { input: handoff });
    } catch {
      try {
        execSync('xsel --clipboard --input', { input: handoff });
      } catch {
        console.log('  ⚠ Could not copy to clipboard. Install xclip or xsel.');
      }
    }
  }
  
  console.log('  ✅ Handoff copied to clipboard!');
  console.log('  Paste it at the start of your next AI session.\n');
}
```

### Usage
```bash
infernoflow switch --copy
# → "✅ Handoff copied to clipboard!"
# → Ctrl+V into next AI chat
```

---

## Fix #7: Git Hook Auto-Capture (P2)

### Where to Add
New command: `infernoflow setup --hooks`

### How to Implement

```javascript
// src/commands/setup-hooks.js

function installHooks() {
  const hooksDir = '.git/hooks';
  
  // Post-commit hook
  const postCommit = `#!/bin/sh
# infernoflow auto-capture
infernoflow log "Committed: $(git log -1 --pretty=%s)" --type note --source git-hook --quiet 2>/dev/null || true
`;

  // Pre-commit hook (check frozen capabilities)
  const preCommit = `#!/bin/sh
# infernoflow frozen capability check
infernoflow check --pre-commit --quiet 2>/dev/null || true
`;

  writeFile(path.join(hooksDir, 'post-commit'), postCommit);
  writeFile(path.join(hooksDir, 'pre-commit'), preCommit);
  
  // Make executable (Unix)
  if (process.platform !== 'win32') {
    chmodSync(path.join(hooksDir, 'post-commit'), '755');
    chmodSync(path.join(hooksDir, 'pre-commit'), '755');
  }
  
  console.log('  ✅ Git hooks installed');
  console.log('  - post-commit: auto-logs commit messages');
  console.log('  - pre-commit: checks frozen capabilities\n');
}
```

---

## Fix #8: CLAUDE.md Auto-Maintenance (P2)

### What This Does
Automatically keeps CLAUDE.md updated with gotchas, decisions, and project context.
AI agents (Claude, Copilot) read this file automatically — zero paste needed.

### How to Implement

```javascript
// src/commands/context.js — enhance existing command

function generateClaudeMd() {
  const sessions = readSessions();
  const gotchas = sessions.filter(e => e.type === 'gotcha');
  const decisions = sessions.filter(e => e.type === 'decision');
  const attempts = sessions.filter(e => e.type === 'attempt');
  
  let md = `# Project Context (auto-generated by infernoflow)\n\n`;
  
  // Project info
  md += `## About\n`;
  md += `Project: ${projectName}\n`;
  md += `Last updated: ${new Date().toISOString()}\n\n`;
  
  // GOTCHAS — most important for AI
  if (gotchas.length > 0) {
    md += `## ⚠️ Known Gotchas (READ THESE FIRST)\n`;
    gotchas.forEach(g => {
      md += `- ${g.msg}`;
      if (g.file) md += ` (${g.file})`;
      md += `\n`;
    });
    md += `\n`;
  }
  
  // DECISIONS
  if (decisions.length > 0) {
    md += `## ✓ Decisions In Effect\n`;
    decisions.forEach(d => md += `- ${d.msg}\n`);
    md += `\n`;
  }
  
  // FAILED ATTEMPTS
  if (attempts.length > 0) {
    md += `## ❌ Things That Don't Work (Don't Try These)\n`;
    attempts.forEach(a => md += `- ${a.msg}\n`);
    md += `\n`;
  }
  
  writeFile('CLAUDE.md', md);
  
  // Also generate .cursorrules if Cursor is detected
  if (fs.existsSync('.cursor') || fs.existsSync('.cursorrules')) {
    writeFile('.cursorrules', md);
  }
  
  // Also generate .github/copilot-instructions.md if .github exists
  if (fs.existsSync('.github')) {
    ensureDir('.github');
    writeFile('.github/copilot-instructions.md', md);
  }
}
```

### Auto-Update on Every Log

```javascript
// In the log command, after writing to sessions.jsonl:
function logEntry(entry) {
  appendSession(entry);
  
  // Auto-update context files if they exist
  if (fs.existsSync('CLAUDE.md')) {
    generateClaudeMd();
  }
}
```

This means: every time the user logs a gotcha, CLAUDE.md is instantly updated. Next AI session reads it automatically. **Zero friction.**

---

## Fix #9: Health Score — Show How to Improve (P2)

### What's Broken
User sees "F (40/100)" but doesn't know what to do.

### How to Fix

```javascript
// After showing the score:

function showHealthTips(score, entries) {
  const gotchas = entries.filter(e => e.type === 'gotcha').length;
  const decisions = entries.filter(e => e.type === 'decision').length;
  
  console.log('\n  How to improve:');
  
  if (gotchas === 0) {
    console.log('  → Log 1 gotcha to reach D:  infernoflow log "..." --type gotcha');
  } else if (gotchas < 3) {
    console.log(`  → Log ${3 - gotchas} more gotcha(s) to reach C`);
  }
  
  if (decisions === 0) {
    console.log('  → Log 1 decision to gain 15 points:  infernoflow log "..." --type decision');
  }
  
  if (score >= 60 && score < 80) {
    console.log('  → Almost B! Log 1 more entry to level up');
  }
  
  if (score >= 80) {
    console.log('  → 🎉 Great session! Your handoff will be excellent.');
  }
}
```

---

## Fix #10: VS Code Extension Icon (P2)

### What's Broken
SVG icon doesn't render in VS Code activity bar.

### Root Cause
Multiple issues: BOM in SVG file, `currentColor` not rendering, corrupted file from multiple writes.

### How to Fix

Use the **exact same pattern** as Roo Code extension (which works):

1. SVG must have `fill: #000` or explicit color (not `currentColor`)
2. SVG must NOT have a UTF-8 BOM
3. SVG must be well-formed XML with `<?xml version="1.0" encoding="UTF-8"?>` header
4. Use `viewBox="0 0 96 96"` (larger viewBox renders better in activity bar)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 96 96">
  <defs>
    <style>
      .cls-1 {
        fill: #000;
        stroke-width: 0px;
      }
    </style>
  </defs>
  <path class="cls-1" d="M48,4 C32,28 24,44 24,60 A24,24 0 0,0 72,60 C72,44 64,28 48,4 Z M48,36 C40,48 36,56 36,64 A12,12 0 0,0 60,64 C60,56 56,48 48,36 Z"/>
</svg>
```

**Important:** Write the file with UTF-8 encoding WITHOUT BOM:
```javascript
// Node.js:
fs.writeFileSync('icon.svg', svgContent, { encoding: 'utf8' });

// PowerShell:
[System.IO.File]::WriteAllText("icon.svg", $content, (New-Object System.Text.UTF8Encoding $false))
```

---

## Summary: Priority Order

| # | Fix | Time | Impact | Difficulty |
|---|---|---|---|---|
| 1 | Scarf install bug on Windows | 1 hour | Users can't install → can install | Easy |
| 2 | PowerShell unicode rendering | 1 day | Looks broken → looks professional | Medium |
| 3 | Simplify `--help` to 5 commands | 1 hour | Overwhelming → clear | Easy |
| 4 | New `init` with first gotcha prompt | 2 days | Confusing → magic moment | Medium |
| 5 | Stunning `switch` with hot files | 2 days | Good → screenshot-worthy | Medium |
| 6 | `switch --copy` clipboard | 2 hours | 4 steps → 1 step | Easy |
| 7 | Git hook auto-capture | 3 days | Manual → automatic | Medium |
| 8 | CLAUDE.md auto-maintenance | 2 days | Manual paste → automatic | Medium |
| 9 | Health score improvement tips | 2 hours | Confusing → actionable | Easy |
| 10 | VS Code extension icon | 1 hour | No icon → flame icon | Easy |

### Do These First (This Week)
1. **Fix #1** — Scarf install (1 hour, unblocks Windows users)
2. **Fix #3** — Simplify help (1 hour, immediate UX improvement)
3. **Fix #6** — `switch --copy` (2 hours, huge convenience)

### Do These Next (Next Week)
4. **Fix #2** — PowerShell unicode (1 day)
5. **Fix #4** — New init flow (2 days)
6. **Fix #5** — Stunning switch output (2 days)

### Do These Month 2
7. **Fix #7** — Git hooks (3 days)
8. **Fix #8** — CLAUDE.md auto-maintenance (2 days)

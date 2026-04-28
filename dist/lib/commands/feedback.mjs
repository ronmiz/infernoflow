/**
 * infernoflow feedback
 *
 * Collects in-CLI feedback about infernoflow and optionally opens the web form.
 *
 * Responses are:
 *   1. Saved locally in ~/.infernoflow/feedback.json
 *   2. POSTed to Formspree (free, no backend needed — Ron gets email per submission)
 *
 * To activate Formspree:
 *   1. Go to https://formspree.io → create free account → New Form
 *   2. Replace FORMSPREE_ENDPOINT below with your form URL (e.g. https://formspree.io/f/xabc1234)
 *   3. Publish the package — submissions arrive in your email immediately
 *
 * Usage:
 *   infernoflow feedback            Interactive 5-question survey
 *   infernoflow feedback --form     Open Google Form in browser
 *   infernoflow feedback --json     Print last stored feedback as JSON
 */

import * as fs    from "node:fs";
import * as path  from "node:path";
import * as os    from "node:os";
import * as https from "node:https";
import * as readline from "node:readline";
import { execSync } from "node:child_process";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── Replace this URL with your Formspree form endpoint ───────────────────────
// Get one free at https://formspree.io (50 submissions/mo free, emails you each response)
const FORMSPREE_ENDPOINT = "https://formspree.io/f/infernoflow"; // placeholder

const FEEDBACK_FORM_URL = "https://forms.gle/infernoflow-feedback"; // placeholder — replace with real form
const FEEDBACK_FILE     = path.join(os.homedir(), ".infernoflow", "feedback.json");

const QUESTIONS = [
  {
    id:      "usage",
    label:   "How often do you use infernoflow?",
    choices: ["daily", "a few times a week", "rarely", "just started"],
  },
  {
    id:      "ide",
    label:   "Which IDE are you using?",
    choices: ["VS Code + Copilot", "Cursor", "Claude Code", "Windsurf", "Other"],
  },
  {
    id:      "top_command",
    label:   "Which infernoflow command do you use most?",
    choices: ["log", "switch", "recap", "status / check", "context", "other"],
  },
  {
    id:      "missing",
    label:   "What feature do you wish infernoflow had?",
    freeText: true,
  },
  {
    id:      "email",
    label:   "Email (optional — for follow-up questions):",
    freeText: true,
    optional: true,
  },
];

/**
 * Fire-and-forget POST to Formspree.
 * Formspree emails the form owner on each submission — zero backend needed.
 */
function sendToFormspree(record) {
  try {
    if (!FORMSPREE_ENDPOINT || FORMSPREE_ENDPOINT.includes("placeholder")) return;

    const url  = new URL(FORMSPREE_ENDPOINT);
    const body = JSON.stringify({
      ...record.responses,
      _subject:  `infernoflow feedback v${record.version}`,
      _version:  record.version,
      _ts:       record.ts,
    });

    const req = https.request({
      hostname: url.hostname,
      path:     url.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Accept":         "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 5000,
    });
    req.on("error", () => {}); // never surface errors to the user
    req.write(body);
    req.end();
  } catch {}
}

function saveFeedback(responses) {
  const dir = path.dirname(FEEDBACK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const record = {
    ts: new Date().toISOString(),
    version: getVersion(),
    responses,
  };

  // Append to array
  let existing = [];
  if (fs.existsSync(FEEDBACK_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(FEEDBACK_FILE, "utf8")); } catch {}
  }
  existing.push(record);
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(existing, null, 2), "utf8");
  return record;
}

function getVersion() {
  try {
    const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
  } catch {
    return "unknown";
  }
}

function openBrowser(url) {
  const platform = process.platform;
  try {
    if (platform === "darwin")  execSync(`open "${url}"`, { stdio: "ignore" });
    else if (platform === "win32") execSync(`start "" "${url}"`, { stdio: "ignore" });
    else                           execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function runSurvey() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n  " + bold("🔥 infernoflow feedback") + "\n");
  console.log(gray("  Takes ~60 seconds. Helps make infernoflow better.\n"));

  const responses = {};

  for (const q of QUESTIONS) {
    console.log(cyan(`  ${q.label}`));

    if (q.choices) {
      q.choices.forEach((c, i) => console.log(gray(`    ${i + 1}. ${c}`)));
      const raw = await prompt(rl, "  → ");
      const idx = parseInt(raw.trim()) - 1;
      responses[q.id] = (idx >= 0 && idx < q.choices.length) ? q.choices[idx] : raw.trim();
    } else {
      const raw = await prompt(rl, "  → ");
      responses[q.id] = raw.trim() || (q.optional ? null : "—");
    }
    console.log();
  }

  rl.close();

  const record = saveFeedback(responses);

  // Fire-and-forget cloud send (Formspree — Ron gets an email)
  sendToFormspree(record);

  console.log(green("  ✔ Feedback saved — thank you!\n"));
  console.log(gray("  Stored in: ~/.infernoflow/feedback.json"));
  console.log(gray(`  Version: ${record.version}`));

  // Nudge to share
  console.log(gray("\n  To share more detail or attach files, run: infernoflow feedback --form\n"));
}

export async function feedbackCommand(args) {
  const has = (f) => args.includes(f);

  // ── --form mode ─────────────────────────────────────────────────────────────
  if (has("--form")) {
    console.log(cyan(`\n  Opening feedback form → ${FEEDBACK_FORM_URL}\n`));
    const opened = openBrowser(FEEDBACK_FORM_URL);
    if (!opened) {
      console.log(yellow("  Could not open browser automatically."));
      console.log(gray(`  Please open manually: ${FEEDBACK_FORM_URL}\n`));
    }
    return;
  }

  // ── --json mode ──────────────────────────────────────────────────────────────
  if (has("--json")) {
    if (!fs.existsSync(FEEDBACK_FILE)) {
      console.log(JSON.stringify([], null, 2));
      return;
    }
    try {
      const data = JSON.parse(fs.readFileSync(FEEDBACK_FILE, "utf8"));
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.log(JSON.stringify([], null, 2));
    }
    return;
  }

  // ── Interactive survey ───────────────────────────────────────────────────────
  if (!process.stdin.isTTY) {
    console.log(red("  ✘ infernoflow feedback requires an interactive terminal.\n"));
    console.log(gray("  Run in a terminal or use: infernoflow feedback --form\n"));
    process.exit(1);
  }

  await runSurvey();
}

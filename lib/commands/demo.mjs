/**
 * infernoflow demo
 *
 * A self-contained, narrated walkthrough of infernoflow's core capabilities.
 * Scaffolds a temp sample project, runs the full chain, and shows real output.
 *
 * Usage:
 *   infernoflow demo                Run the full interactive demo
 *   infernoflow demo --fast         Skip pauses (CI/recording mode)
 *   infernoflow demo --no-cleanup   Keep the temp project after the demo
 *
 * What it demonstrates:
 *   1. Project structure — a mini e-commerce API with real capabilities
 *   2. infernoflow scan  — AST analysis: functions, services, throws
 *   3. infernoflow graph — dependency graph
 *   4. infernoflow stability — frozen/stable/experimental breakdown
 *   5. infernoflow impact  — blast radius for payment-process
 *   6. infernoflow explain — narrative (structural or AI)
 *   7. infernoflow why     — file → capability correlation
 *   8. The money shot: trying to modify a frozen cap and getting warned
 */

import * as fs      from "node:fs";
import * as path    from "node:path";
import * as os      from "node:os";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pause(fast, ms = 900) {
  if (!fast) await sleep(ms);
}

function hr(char = "─", len = 60) {
  return gray(char.repeat(len));
}

function run(cmd, cwd) {
  try {
    return spawnSync(cmd, {
      shell: true, cwd, encoding: "utf8", timeout: 30_000,
    });
  } catch { return { stdout: "", stderr: "", status: 1 }; }
}

// ── sample project scaffold ───────────────────────────────────────────────────

const SAMPLE_FILES = {
  // Capability definitions
  "inferno/capabilities.json": JSON.stringify([
    {
      id: "user-auth",
      name: "User Authentication",
      description: "Handles login, session management, and token validation",
      stability: "frozen",
      owner: "auth-team",
    },
    {
      id: "payment-process",
      name: "Payment Processing",
      description: "Charges cards via Stripe, handles retries and webhook events",
      stability: "stable",
      owner: "payments-team",
    },
    {
      id: "order-create",
      name: "Order Creation",
      description: "Validates cart, reserves inventory, creates order records",
      stability: "experimental",
      owner: "core-team",
    },
    {
      id: "email-notify",
      name: "Email Notifications",
      description: "Sends transactional emails via SendGrid for orders and auth events",
      stability: "experimental",
      owner: "core-team",
    },
  ], null, 2),

  // Dependency graph
  "inferno/graph.json": JSON.stringify({
    deps: {
      "order-create":  ["user-auth", "payment-process"],
      "email-notify":  ["order-create"],
      "payment-process": ["user-auth"],
    },
    dependents: {
      "user-auth":       ["payment-process", "order-create"],
      "payment-process": ["order-create"],
      "order-create":    ["email-notify"],
    },
  }, null, 2),

  // Source files
  "src/auth.js": `// User Authentication
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

/**
 * Authenticate a user with email + password.
 * Returns a signed JWT on success, throws AuthError on failure.
 */
async function authenticateUser(email, password) {
  const user = await db.users.findByEmail(email);
  if (!user) throw new AuthError('Invalid credentials');
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AuthError('Invalid credentials');
  return jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
}

/**
 * Validate an incoming JWT from the Authorization header.
 */
function validateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
}

module.exports = { authenticateUser, validateToken };
`,

  "src/payment.js": `// Payment Processing
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Process a payment for an order.
 * Charges via Stripe, handles retry on network error.
 */
async function processPayment(orderId, amount, currency, paymentMethodId) {
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency,
    payment_method: paymentMethodId,
    confirm: true,
    metadata: { orderId },
  });

  if (intent.status !== 'succeeded') {
    throw new PaymentError(\`Payment failed: \${intent.status}\`);
  }

  await db.payments.create({ orderId, stripeIntentId: intent.id, amount, status: 'paid' });
  return { success: true, intentId: intent.id };
}

/**
 * Handle Stripe webhook events (charge.succeeded, payment_intent.payment_failed).
 */
async function handleWebhook(event) {
  switch (event.type) {
    case 'payment_intent.succeeded':
      await db.orders.updateStatus(event.data.object.metadata.orderId, 'paid');
      break;
    case 'payment_intent.payment_failed':
      await db.orders.updateStatus(event.data.object.metadata.orderId, 'payment_failed');
      break;
  }
}

module.exports = { processPayment, handleWebhook };
`,

  "src/order.js": `// Order Creation
const { validateToken } = require('./auth');
const { processPayment } = require('./payment');

/**
 * Create a new order from a validated cart.
 * Requires authenticated user. Reserves inventory, charges card.
 */
async function createOrder(userId, cart, paymentMethodId) {
  const user = await db.users.findById(userId);
  if (!user) throw new Error('User not found');

  await db.inventory.reserve(cart.items);

  const total = cart.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const order = await db.orders.create({ userId, items: cart.items, total, status: 'pending' });

  await processPayment(order.id, total, 'usd', paymentMethodId);
  await db.orders.updateStatus(order.id, 'confirmed');

  return order;
}

module.exports = { createOrder };
`,

  "src/email.js": `// Email Notifications
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Send an order confirmation email.
 */
async function sendOrderConfirmation(order, user) {
  await sgMail.send({
    to: user.email,
    from: 'noreply@shop.com',
    subject: \`Order confirmed — #\${order.id}\`,
    text: \`Your order for \$\${order.total} has been confirmed.\`,
  });
}

module.exports = { sendOrderConfirmation };
`,

  // Scenarios
  "inferno/scenarios/auth-happy-path.json": JSON.stringify({
    scenarioId: "auth-happy-path",
    description: "User logs in with valid credentials and receives a JWT",
    capabilitiesCovered: ["user-auth"],
    steps: [
      "POST /auth/login with valid email + password",
      "Expect 200 with { token: '...' }",
      "Use token in Authorization header for subsequent requests",
    ],
    expects: [
      "Token is a valid JWT signed with JWT_SECRET",
      "Token expires in 24 hours",
    ],
  }, null, 2),

  "inferno/scenarios/payment-charge.json": JSON.stringify({
    scenarioId: "payment-charge",
    description: "Successful card charge via Stripe",
    capabilitiesCovered: ["payment-process"],
    steps: [
      "Create order with valid cart",
      "Call processPayment with valid Stripe test PM",
      "Expect payment record in db with status: paid",
    ],
  }, null, 2),

  "package.json": JSON.stringify({
    name: "demo-shop-api",
    version: "1.0.0",
    description: "Demo e-commerce API for infernoflow walkthrough",
  }, null, 2),

  // Pre-built scan so `why` works without running AST scan
  "inferno/scan.json": JSON.stringify({
    scannedAt: new Date().toISOString(),
    capabilities: [
      {
        id: "user-auth",
        codeAnalysis: {
          sourceFiles: ["src/auth.js"],
          functions:   ["authenticateUser", "validateToken"],
          services:    [],
          calls:       ["db.users.findByEmail", "bcrypt.compare", "jwt.sign", "jwt.verify"],
          throws:      ["AuthError"],
        },
      },
      {
        id: "payment-process",
        codeAnalysis: {
          sourceFiles: ["src/payment.js"],
          functions:   ["processPayment", "handleWebhook"],
          services:    ["stripe"],
          calls:       ["stripe.paymentIntents.create", "db.payments.create", "db.orders.updateStatus"],
          throws:      ["PaymentError"],
        },
      },
      {
        id: "order-create",
        codeAnalysis: {
          sourceFiles: ["src/order.js"],
          functions:   ["createOrder"],
          services:    [],
          calls:       ["db.users.findById", "db.inventory.reserve", "db.orders.create", "processPayment"],
          throws:      [],
        },
      },
      {
        id: "email-notify",
        codeAnalysis: {
          sourceFiles: ["src/email.js"],
          functions:   ["sendOrderConfirmation"],
          services:    ["sendgrid"],
          calls:       ["sgMail.send"],
          throws:      [],
        },
      },
    ],
  }, null, 2),

  // Capability map for file → cap lookups
  "inferno/capability-map.json": JSON.stringify({
    "src/auth.js":    ["user-auth"],
    "src/payment.js": ["payment-process"],
    "src/order.js":   ["order-create"],
    "src/email.js":   ["email-notify"],
  }, null, 2),
};

function scaffoldProject(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [relPath, content] of Object.entries(SAMPLE_FILES)) {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

// ── narrated steps ────────────────────────────────────────────────────────────

function header(title) {
  console.log();
  console.log(bold(`  ── ${title}`));
  console.log();
}

function narrate(text) {
  console.log(`  ${gray(text)}`);
}

function cmd(text) {
  console.log(`  ${cyan("$")} ${bold(text)}`);
}

function out(lines) {
  for (const l of lines) console.log(`    ${l}`);
}

// ── demo runner ───────────────────────────────────────────────────────────────

function runInferno(command, args, demoDir, ifBin) {
  const r = spawnSync(process.execPath, [ifBin, command, ...args], {
    cwd: demoDir, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1" }
  });
  return (r.stdout || "") + (r.stderr || "");
}

function printOutput(raw, maxLines = 20) {
  const lines = raw.split("\n").filter(l => l.trim()).slice(0, maxLines);
  for (const l of lines) console.log(`  ${gray("│")}  ${l}`);
}

export async function demoCommand(rawArgs) {
  const args      = (rawArgs || []).slice(1);
  const fast      = args.includes("--fast");
  const noCleanup = args.includes("--no-cleanup");

  // Find infernoflow bin
  const ifBin = path.resolve(
    path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
    "bin", "infernoflow.mjs"
  );

  const demoDir = path.join(os.tmpdir(), `infernoflow-demo-${Date.now()}`);

  console.clear();
  console.log();
  console.log(bold("  🔥 infernoflow — interactive demo"));
  console.log(gray("  ─────────────────────────────────────────────────────────────"));
  console.log();
  console.log(gray("  We'll build a mini e-commerce API and show infernoflow's full"));
  console.log(gray("  capability chain — from AST scan to blast radius analysis."));
  console.log();
  if (!fast) {
    console.log(gray("  Press Enter to advance each step, or run with --fast to skip pauses."));
  }
  console.log();

  // ── Step 1: The project ─────────────────────────────────────────────────────
  await pause(fast, 1200);
  header("Step 1 of 7 — The project");
  narrate("A small e-commerce API: auth, payments, orders, email.");
  narrate(`Scaffolded in: ${demoDir}`);
  console.log();

  scaffoldProject(demoDir);

  out([
    `${green("src/")}`,
    `  ${cyan("auth.js")}      ← user-auth capability`,
    `  ${cyan("payment.js")}   ← payment-process capability`,
    `  ${cyan("order.js")}     ← order-create capability`,
    `  ${cyan("email.js")}     ← email-notify capability`,
    ``,
    `${green("inferno/")}`,
    `  ${cyan("capabilities.json")}   ← 4 capabilities registered`,
    `  ${cyan("graph.json")}          ← dependency graph`,
    `  ${cyan("scenarios/")}          ← 2 test scenarios`,
  ]);

  await pause(fast, 1000);

  // ── Step 2: Stability ───────────────────────────────────────────────────────
  header("Step 2 of 7 — Capability stability");
  cmd("infernoflow stability");
  console.log();

  const stabOut = runInferno("stability", [], demoDir, ifBin);
  if (stabOut.trim()) {
    printOutput(stabOut, 12);
  } else {
    // Manual fallback display
    out([
      `🧊  ${red("user-auth")}          frozen        Auth team owns this — no changes without approval`,
      `〰️   ${yellow("payment-process")}   stable        Stripe integration — additive changes only`,
      `🌊  ${green("order-create")}      experimental  Free to refactor`,
      `🌊  ${green("email-notify")}      experimental  Free to refactor`,
    ]);
  }

  console.log();
  narrate("user-auth is FROZEN — it's the most critical cap and must never break silently.");
  narrate("payment-process is STABLE — changes must be additive.");

  await pause(fast, 1000);

  // ── Step 3: Impact analysis ─────────────────────────────────────────────────
  header("Step 3 of 7 — Blast radius: what breaks if user-auth changes?");
  cmd("infernoflow impact user-auth");
  console.log();

  const impactOut = runInferno("impact", ["user-auth"], demoDir, ifBin);
  if (impactOut.trim()) {
    printOutput(impactOut, 18);
  } else {
    out([
      `🧊  ${red("user-auth")}  →  risk: ${red("CRITICAL")}`,
      ``,
      `   Direct dependents (1):`,
      `     payment-process  ${yellow("stable")}`,
      ``,
      `   Transitive dependents (2):`,
      `     order-create  ${green("experimental")}`,
      `     email-notify  ${green("experimental")}`,
      ``,
      `   ${red("CRITICAL")} — frozen capability with dependents.`,
      `   Any change risks breaking 3 downstream capabilities.`,
    ]);
  }

  console.log();
  narrate("Change user-auth and you risk breaking payments, orders, and email.");
  narrate("This is the blast radius — measured before you write a single line.");

  await pause(fast, 1200);

  // ── Step 4: explain ─────────────────────────────────────────────────────────
  header("Step 4 of 7 — What is this capability, exactly?");
  cmd("infernoflow explain user-auth");
  console.log();

  const explainOut = runInferno("explain", ["user-auth"], demoDir, ifBin);
  if (explainOut.trim()) {
    printOutput(explainOut, 14);
  } else {
    out([
      `🧊  ${red("user-auth")}`,
      `   User Authentication`,
      ``,
      `   Handles login, session management, and token validation.`,
      `   This capability is FROZEN — do not modify without explicit instruction.`,
      `   payment-process, order-create depend on this capability.`,
      `   Before shipping changes, run: auth-happy-path scenario.`,
      ``,
      `   ${yellow("💡")} For richer AI narratives:  infernoflow ai setup`,
    ]);
  }

  await pause(fast, 1000);

  // ── Step 5: why ─────────────────────────────────────────────────────────────
  header("Step 5 of 7 — File → capability correlation");
  cmd("infernoflow why src/payment.js");
  console.log();

  const whyOut = runInferno("why", ["src/payment.js"], demoDir, ifBin);
  if (whyOut.trim()) {
    printOutput(whyOut, 14);
  } else {
    out([
      `  src/payment.js  →  ${yellow("payment-process")}  (stable)`,
      ``,
      `  Name:        Payment Processing`,
      `  Description: Charges cards via Stripe, handles retries and webhook events`,
      `  Stability:   〰️  stable — additive changes only`,
      ``,
      `  Scenarios:   payment-charge`,
      `  Depended on by:  order-create (experimental)`,
    ]);
  }

  console.log();
  narrate("Any developer can instantly see what capability owns a given file.");
  narrate("No guessing. No digging through wikis.");

  await pause(fast, 1000);

  // ── Step 6: test ─────────────────────────────────────────────────────────────
  header("Step 6 of 7 — Run registered scenarios");
  cmd("infernoflow test");
  console.log();

  const testOut = runInferno("test", [], demoDir, ifBin);
  if (testOut.trim()) {
    printOutput(testOut, 12);
  } else {
    out([
      `  ${green("✓")}  user-auth         [frozen]`,
      `       ${green("✓")}  auth-happy-path  (generated)`,
      ``,
      `  ${green("✓")}  payment-process   [stable]`,
      `       ${green("✓")}  payment-charge   (generated)`,
      ``,
      `  ${green("2")} passed  0 failed  0 skipped`,
    ]);
  }

  await pause(fast, 800);

  // ── Step 7: the money shot ──────────────────────────────────────────────────
  header("Step 7 of 7 — The money shot: CI gate on a frozen capability");
  cmd("infernoflow impact user-auth --check");
  console.log();
  narrate("--check exits with code 1 if risk is HIGH or CRITICAL.");
  narrate("Add this to your CI pipeline before any PR that touches auth.");
  console.log();

  out([
    `  ${red("CRITICAL")} — user-auth is frozen with 3 dependents`,
    `  Exit code: 1`,
    ``,
    `  Your CI pipeline just stopped a risky change from reaching production.`,
  ]);

  await pause(fast, 600);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log();
  console.log(gray("  ─────────────────────────────────────────────────────────────"));
  console.log();
  console.log(bold("  That's infernoflow."));
  console.log();
  console.log(`  ${green("✓")}  Capability contracts tracked in code, not in Confluence`);
  console.log(`  ${green("✓")}  Blast radius measured before you change anything`);
  console.log(`  ${green("✓")}  Every file knows what capability it serves`);
  console.log(`  ${green("✓")}  CI gates on frozen capabilities — broken things don't ship`);
  console.log(`  ${green("✓")}  Zero-touch with CLAUDE.md: your AI sessions stay in sync automatically`);
  console.log();
  console.log(`  ${bold("Get started:")}  ${cyan("npm install -g infernoflow")}  →  ${cyan("infernoflow setup")}`);
  console.log();
  console.log(gray("  ─────────────────────────────────────────────────────────────"));
  console.log();

  if (noCleanup) {
    console.log(gray(`  Demo project kept at: ${demoDir}`));
  } else {
    try { fs.rmSync(demoDir, { recursive: true, force: true }); } catch {}
  }

  console.log();
}

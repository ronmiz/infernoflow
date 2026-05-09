import*as b from"node:fs";import*as u from"node:path";import*as A from"node:os";import{fileURLToPath as E}from"node:url";import{spawnSync as C}from"node:child_process";import{bold as y,cyan as o,gray as a,green as r,yellow as v,red as h}from"../ui/output.mjs";function T(e){return new Promise(t=>setTimeout(t,e))}async function d(e,t=900){e||await T(t)}function J(e="\u2500",t=60){return a(e.repeat(t))}function q(e,t){try{return C(e,{shell:!0,cwd:t,encoding:"utf8",timeout:3e4})}catch{return{stdout:"",stderr:"",status:1}}}const P={"inferno/capabilities.json":JSON.stringify([{id:"user-auth",name:"User Authentication",description:"Handles login, session management, and token validation",stability:"frozen",owner:"auth-team"},{id:"payment-process",name:"Payment Processing",description:"Charges cards via Stripe, handles retries and webhook events",stability:"stable",owner:"payments-team"},{id:"order-create",name:"Order Creation",description:"Validates cart, reserves inventory, creates order records",stability:"experimental",owner:"core-team"},{id:"email-notify",name:"Email Notifications",description:"Sends transactional emails via SendGrid for orders and auth events",stability:"experimental",owner:"core-team"}],null,2),"inferno/graph.json":JSON.stringify({deps:{"order-create":["user-auth","payment-process"],"email-notify":["order-create"],"payment-process":["user-auth"]},dependents:{"user-auth":["payment-process","order-create"],"payment-process":["order-create"],"order-create":["email-notify"]}},null,2),"src/auth.js":`// User Authentication
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
`,"src/payment.js":`// Payment Processing
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
`,"src/order.js":`// Order Creation
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
`,"src/email.js":`// Email Notifications
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/**
 * Send an order confirmation email.
 */
async function sendOrderConfirmation(order, user) {
  await sgMail.send({
    to: user.email,
    from: 'noreply@shop.com',
    subject: \`Order confirmed \u2014 #\${order.id}\`,
    text: \`Your order for $\${order.total} has been confirmed.\`,
  });
}

module.exports = { sendOrderConfirmation };
`,"inferno/scenarios/auth-happy-path.json":JSON.stringify({scenarioId:"auth-happy-path",description:"User logs in with valid credentials and receives a JWT",capabilitiesCovered:["user-auth"],steps:["POST /auth/login with valid email + password","Expect 200 with { token: '...' }","Use token in Authorization header for subsequent requests"],expects:["Token is a valid JWT signed with JWT_SECRET","Token expires in 24 hours"]},null,2),"inferno/scenarios/payment-charge.json":JSON.stringify({scenarioId:"payment-charge",description:"Successful card charge via Stripe",capabilitiesCovered:["payment-process"],steps:["Create order with valid cart","Call processPayment with valid Stripe test PM","Expect payment record in db with status: paid"]},null,2),"package.json":JSON.stringify({name:"demo-shop-api",version:"1.0.0",description:"Demo e-commerce API for infernoflow walkthrough"},null,2),"inferno/scan.json":JSON.stringify({scannedAt:new Date().toISOString(),capabilities:[{id:"user-auth",codeAnalysis:{sourceFiles:["src/auth.js"],functions:["authenticateUser","validateToken"],services:[],calls:["db.users.findByEmail","bcrypt.compare","jwt.sign","jwt.verify"],throws:["AuthError"]}},{id:"payment-process",codeAnalysis:{sourceFiles:["src/payment.js"],functions:["processPayment","handleWebhook"],services:["stripe"],calls:["stripe.paymentIntents.create","db.payments.create","db.orders.updateStatus"],throws:["PaymentError"]}},{id:"order-create",codeAnalysis:{sourceFiles:["src/order.js"],functions:["createOrder"],services:[],calls:["db.users.findById","db.inventory.reserve","db.orders.create","processPayment"],throws:[]}},{id:"email-notify",codeAnalysis:{sourceFiles:["src/email.js"],functions:["sendOrderConfirmation"],services:["sendgrid"],calls:["sgMail.send"],throws:[]}}]},null,2),"inferno/capability-map.json":JSON.stringify({"src/auth.js":["user-auth"],"src/payment.js":["payment-process"],"src/order.js":["order-create"],"src/email.js":["email-notify"]},null,2)};function x(e){b.mkdirSync(e,{recursive:!0});for(const[t,n]of Object.entries(P)){const s=u.join(e,t);b.mkdirSync(u.dirname(s),{recursive:!0}),b.writeFileSync(s,n)}}function p(e){console.log(),console.log(y(`  \u2500\u2500 ${e}`)),console.log()}function i(e){console.log(`  ${a(e)}`)}function f(e){console.log(`  ${o("$")} ${y(e)}`)}function m(e){for(const t of e)console.log(`    ${t}`)}function g(e,t,n,s){const l=C(process.execPath,[s,e,...t],{cwd:n,encoding:"utf8",timeout:3e4,env:{...process.env,NO_COLOR:"1"}});return(l.stdout||"")+(l.stderr||"")}function w(e,t=20){const n=e.split(`
`).filter(s=>s.trim()).slice(0,t);for(const s of n)console.log(`  ${a("\u2502")}  ${s}`)}async function F(e){const t=(e||[]).slice(1),n=t.includes("--fast"),s=t.includes("--no-cleanup"),l=u.resolve(u.dirname(u.dirname(u.dirname(E(import.meta.url)))),"bin","infernoflow.mjs"),c=u.join(A.tmpdir(),`infernoflow-demo-${Date.now()}`);console.clear(),console.log(),console.log(y("  \u{1F525} infernoflow \u2014 interactive demo")),console.log(a("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")),console.log(),console.log(a("  We'll build a mini e-commerce API and show infernoflow's full")),console.log(a("  capability chain \u2014 from AST scan to blast radius analysis.")),console.log(),n||console.log(a("  Press Enter to advance each step, or run with --fast to skip pauses.")),console.log(),await d(n,1200),p("Step 1 of 7 \u2014 The project"),i("A small e-commerce API: auth, payments, orders, email."),i(`Scaffolded in: ${c}`),console.log(),x(c),m([`${r("src/")}`,`  ${o("auth.js")}      \u2190 user-auth capability`,`  ${o("payment.js")}   \u2190 payment-process capability`,`  ${o("order.js")}     \u2190 order-create capability`,`  ${o("email.js")}     \u2190 email-notify capability`,"",`${r("inferno/")}`,`  ${o("capabilities.json")}   \u2190 4 capabilities registered`,`  ${o("graph.json")}          \u2190 dependency graph`,`  ${o("scenarios/")}          \u2190 2 test scenarios`]),await d(n,1e3),p("Step 2 of 7 \u2014 Capability stability"),f("infernoflow stability"),console.log();const S=g("stability",[],c,l);S.trim()?w(S,12):m([`\u{1F9CA}  ${h("user-auth")}          frozen        Auth team owns this \u2014 no changes without approval`,`\u3030\uFE0F   ${v("payment-process")}   stable        Stripe integration \u2014 additive changes only`,`\u{1F30A}  ${r("order-create")}      experimental  Free to refactor`,`\u{1F30A}  ${r("email-notify")}      experimental  Free to refactor`]),console.log(),i("user-auth is FROZEN \u2014 it's the most critical cap and must never break silently."),i("payment-process is STABLE \u2014 changes must be additive."),await d(n,1e3),p("Step 3 of 7 \u2014 Blast radius: what breaks if user-auth changes?"),f("infernoflow impact user-auth"),console.log();const $=g("impact",["user-auth"],c,l);$.trim()?w($,18):m([`\u{1F9CA}  ${h("user-auth")}  \u2192  risk: ${h("CRITICAL")}`,"","   Direct dependents (1):",`     payment-process  ${v("stable")}`,"","   Transitive dependents (2):",`     order-create  ${r("experimental")}`,`     email-notify  ${r("experimental")}`,"",`   ${h("CRITICAL")} \u2014 frozen capability with dependents.`,"   Any change risks breaking 3 downstream capabilities."]),console.log(),i("Change user-auth and you risk breaking payments, orders, and email."),i("This is the blast radius \u2014 measured before you write a single line."),await d(n,1200),p("Step 4 of 7 \u2014 What is this capability, exactly?"),f("infernoflow explain user-auth"),console.log();const I=g("explain",["user-auth"],c,l);I.trim()?w(I,14):m([`\u{1F9CA}  ${h("user-auth")}`,"   User Authentication","","   Handles login, session management, and token validation.","   This capability is FROZEN \u2014 do not modify without explicit instruction.","   payment-process, order-create depend on this capability.","   Before shipping changes, run: auth-happy-path scenario.","",`   ${v("\u{1F4A1}")} For richer AI narratives:  infernoflow ai setup`]),await d(n,1e3),p("Step 5 of 7 \u2014 File \u2192 capability correlation"),f("infernoflow why src/payment.js"),console.log();const j=g("why",["src/payment.js"],c,l);j.trim()?w(j,14):m([`  src/payment.js  \u2192  ${v("payment-process")}  (stable)`,"","  Name:        Payment Processing","  Description: Charges cards via Stripe, handles retries and webhook events","  Stability:   \u3030\uFE0F  stable \u2014 additive changes only","","  Scenarios:   payment-charge","  Depended on by:  order-create (experimental)"]),console.log(),i("Any developer can instantly see what capability owns a given file."),i("No guessing. No digging through wikis."),await d(n,1e3),p("Step 6 of 7 \u2014 Run registered scenarios"),f("infernoflow test"),console.log();const k=g("test",[],c,l);if(k.trim()?w(k,12):m([`  ${r("\u2713")}  user-auth         [frozen]`,`       ${r("\u2713")}  auth-happy-path  (generated)`,"",`  ${r("\u2713")}  payment-process   [stable]`,`       ${r("\u2713")}  payment-charge   (generated)`,"",`  ${r("2")} passed  0 failed  0 skipped`]),await d(n,800),p("Step 7 of 7 \u2014 The money shot: CI gate on a frozen capability"),f("infernoflow impact user-auth --check"),console.log(),i("--check exits with code 1 if risk is HIGH or CRITICAL."),i("Add this to your CI pipeline before any PR that touches auth."),console.log(),m([`  ${h("CRITICAL")} \u2014 user-auth is frozen with 3 dependents`,"  Exit code: 1","","  Your CI pipeline just stopped a risky change from reaching production."]),await d(n,600),console.log(),console.log(a("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")),console.log(),console.log(y("  That's infernoflow.")),console.log(),console.log(`  ${r("\u2713")}  Capability contracts tracked in code, not in Confluence`),console.log(`  ${r("\u2713")}  Blast radius measured before you change anything`),console.log(`  ${r("\u2713")}  Every file knows what capability it serves`),console.log(`  ${r("\u2713")}  CI gates on frozen capabilities \u2014 broken things don't ship`),console.log(`  ${r("\u2713")}  Zero-touch with CLAUDE.md: your AI sessions stay in sync automatically`),console.log(),console.log(`  ${y("Get started:")}  ${o("npm install -g infernoflow")}  \u2192  ${o("infernoflow setup")}`),console.log(),console.log(a("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")),console.log(),s)console.log(a(`  Demo project kept at: ${c}`));else try{b.rmSync(c,{recursive:!0,force:!0})}catch{}console.log()}export{F as demoCommand};

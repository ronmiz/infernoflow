/**
 * infernoflow ai
 *
 * Manage AI provider configuration for infernoflow commands
 * (explain, why, review, changelog, etc.)
 *
 * Subcommands:
 *   infernoflow ai setup               Interactive guided setup
 *   infernoflow ai status              Show configured providers and which is active
 *   infernoflow ai test [provider]     Send a test prompt and show response
 *   infernoflow ai clear [provider]    Remove a provider's API key from config
 *
 * Config is stored in inferno/integrations.json (project-scoped).
 * API keys can also come from environment variables (checked first).
 *
 * Supported providers:
 *   anthropic   ANTHROPIC_API_KEY   claude-sonnet-4-6
 *   openai      OPENAI_API_KEY      gpt-4o
 *   gemini      GOOGLE_AI_API_KEY   gemini-2.0-flash
 *   openrouter  OPENROUTER_API_KEY  (any model)
 *   ollama      (local, no key)     llama3.2
 */

import * as fs       from "node:fs";
import * as path     from "node:path";
import * as https    from "node:https";
import * as http     from "node:http";
import * as readline from "node:readline";
import { bold, cyan, gray, green, yellow, red } from "../ui/output.mjs";

// ── config helpers ────────────────────────────────────────────────────────────

function infernoDir(cwd) { return path.join(cwd, "inferno"); }

function loadConfig(cwd) {
  const p = path.join(infernoDir(cwd), "integrations.json");
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

function saveConfig(cwd, config) {
  const dir = infernoDir(cwd);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "integrations.json"), JSON.stringify(config, null, 2) + "\n");
}

// ── provider definitions ──────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id:      "anthropic",
    name:    "Anthropic (Claude)",
    envKey:  "ANTHROPIC_API_KEY",
    models:  ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"],
    default: "claude-sonnet-4-6",
    keyHint: "sk-ant-api03-…",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id:      "openai",
    name:    "OpenAI (GPT)",
    envKey:  "OPENAI_API_KEY",
    models:  ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    default: "gpt-4o",
    keyHint: "sk-…",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  {
    id:      "gemini",
    name:    "Google Gemini",
    envKey:  "GOOGLE_AI_API_KEY",
    models:  ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    default: "gemini-2.0-flash",
    keyHint: "AIza…",
    docsUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id:      "openrouter",
    name:    "OpenRouter",
    envKey:  "OPENROUTER_API_KEY",
    models:  ["anthropic/claude-sonnet-4-6", "openai/gpt-4o", "meta-llama/llama-3.1-8b-instruct:free"],
    default: "anthropic/claude-sonnet-4-6",
    keyHint: "sk-or-…",
    docsUrl: "https://openrouter.ai/keys",
  },
  {
    id:      "ollama",
    name:    "Ollama (local)",
    envKey:  null,
    models:  ["llama3.2", "mistral", "codellama", "phi3"],
    default: "llama3.2",
    keyHint: null,
    docsUrl: "https://ollama.com",
  },
];

// ── HTTP probe ────────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === "https:" ? https : http;
    const req    = lib.request({ hostname: parsed.hostname, port: parsed.port || (parsed.protocol === "https:" ? 443 : 80), path: parsed.pathname + (parsed.search || ""), method: "GET", timeout: 5000 }, (res) => {
      let raw = "";
      res.on("data", d => (raw += d));
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, body: raw }); } });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── provider status check ─────────────────────────────────────────────────────

async function checkProviderStatus(providerId, config) {
  const envMap = {
    anthropic:  process.env.ANTHROPIC_API_KEY,
    openai:     process.env.OPENAI_API_KEY,
    gemini:     process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  };

  const fromEnv    = envMap[providerId];
  const fromConfig = config[providerId]?.apiKey;
  const key        = fromEnv || fromConfig;
  const source     = fromEnv ? "env" : fromConfig ? "integrations.json" : null;
  const model      = config[providerId]?.model || PROVIDERS.find(p => p.id === providerId)?.default;

  if (providerId === "ollama") {
    // Check if Ollama is running
    const probe = await httpGet("http://localhost:11434/api/tags").catch(() => null);
    if (probe?.status === 200) {
      const models = probe.body?.models?.map(m => m.name) || [];
      return { configured: true, source: "local", model: config.ollama?.model || "llama3.2", available: true, models };
    }
    return { configured: false, source: null, model: null, available: false };
  }

  return { configured: !!key, source, model, available: null, masked: key ? key.slice(0, 8) + "…" : null };
}

// ── ai test prompt ────────────────────────────────────────────────────────────

async function testProvider(providerId, config, cwd) {
  try {
    const { callAI } = await import("../ai/providerRouter.mjs");
    const testPrompt = `Reply with exactly: "infernoflow AI test OK — ${providerId}"`;
    const result = await callAI(testPrompt, cwd, providerId);
    return result;
  } catch {
    return null;
  }
}

// ── readline helper ───────────────────────────────────────────────────────────

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

// ── subcommands ───────────────────────────────────────────────────────────────

async function cmdStatus(cwd) {
  const config = loadConfig(cwd);

  console.log();
  console.log(`  ${bold("infernoflow ai")}  ${gray("— provider status")}`);
  console.log();

  let anyConfigured = false;

  for (const p of PROVIDERS) {
    const status = await checkProviderStatus(p.id, config);
    if (status.configured) anyConfigured = true;

    const icon  = status.configured ? green("✓") : gray("○");
    const label = bold(p.name.padEnd(22));
    const info  = status.configured
      ? `${green("configured")}  ${gray(status.source)}  ${gray("model: " + status.model)}${status.masked ? "  " + gray(status.masked) : ""}`
      : gray("not configured");
    console.log(`  ${icon}  ${label}  ${info}`);
  }

  console.log();

  if (!anyConfigured) {
    console.log(`  ${yellow("No AI providers configured.")}  Run: ${cyan("infernoflow ai setup")}`);
    console.log(`  ${gray("Without a provider, explain/why/review use structural fallbacks.")}`);
  } else {
    console.log(`  ${gray("Run")} ${cyan("infernoflow ai test")} ${gray("to verify the active provider.")}`);
  }
  console.log();
}

async function cmdSetup(cwd) {
  const config = loadConfig(cwd);

  // Check which providers already have keys (env vars or saved config)
  const envKeys = {
    anthropic:  process.env.ANTHROPIC_API_KEY,
    openai:     process.env.OPENAI_API_KEY,
    gemini:     process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
  };

  console.log();
  console.log(`  ${bold("🔥 infernoflow ai setup")}`);
  console.log(`  ${gray("Connect an AI provider for explain, why, review, and changelog.")}`);
  console.log();

  // Numbered menu
  PROVIDERS.forEach((p, i) => {
    const envKey    = envKeys[p.id];
    const savedKey  = config[p.id]?.apiKey;
    const detected  = envKey  ? green(" ✓ key detected in environment") :
                      savedKey ? green(" ✓ key already saved") : "";
    const num       = bold(String(i + 1));
    const local     = p.id === "ollama" ? gray("  (local, no key needed)") : "";
    console.log(`  ${num})  ${bold(p.name.padEnd(22))}${local}${detected}`);
  });

  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Numbered selection
    const choice = await prompt(rl, `  Select provider [1]: `);
    const idx    = (parseInt(choice.trim()) || 1) - 1;

    if (idx < 0 || idx >= PROVIDERS.length) {
      console.log(red(`  Invalid choice. Enter a number 1–${PROVIDERS.length}.`));
      return;
    }

    const provider   = PROVIDERS[idx];
    const providerId = provider.id;

    console.log();
    console.log(`  ${bold(provider.name)}`);

    if (providerId === "ollama") {
      // Ollama — no key needed
      const hostInput  = await prompt(rl, `  Ollama host [http://localhost:11434]: `);
      const modelInput = await prompt(rl, `  Model [${provider.default}]: `);

      config.ollama = {
        host:  hostInput.trim()  || "http://localhost:11434",
        model: modelInput.trim() || provider.default,
      };
      saveConfig(cwd, config);

      console.log();
      process.stdout.write(`  ${green("✓")} Saved. Testing connection…  `);
      const probe = await httpGet(`${config.ollama.host}/api/tags`).catch(() => null);
      if (probe?.status === 200) {
        console.log(green("OK"));
      } else {
        console.log(yellow("not reachable"));
        console.log(`  ${yellow("⚠")}  Start Ollama first: ${cyan("ollama serve")}`);
      }

    } else {
      // API key provider
      const envKey    = envKeys[providerId];
      const savedKey  = config[providerId]?.apiKey;
      const existing  = envKey || savedKey;

      if (existing) {
        // Key already detected — confirm or replace
        const source = envKey ? "environment variable" : "saved config";
        console.log(`  ${green("✓")} API key detected from ${source}: ${gray(existing.slice(0, 12) + "…")}`);
        const useIt = await prompt(rl, `  Use this key? [Y/n]: `);
        if (useIt.trim().toLowerCase() === "n") {
          console.log();
          if (provider.docsUrl) console.log(`  ${gray("Get a key at:")} ${cyan(provider.docsUrl)}`);
          const keyInput = await prompt(rl, `  Paste new API key: `);
          if (!keyInput.trim()) { console.log(red("  No key provided. Exiting.")); return; }
          config[providerId] = { apiKey: keyInput.trim(), model: config[providerId]?.model || provider.default };
        } else {
          // Use existing key — just confirm/update model
          config[providerId] = { apiKey: existing, model: config[providerId]?.model || provider.default };
        }
      } else {
        // No key found — ask for it
        console.log(`  ${gray("Get your API key at:")} ${cyan(provider.docsUrl)}`);
        console.log(`  ${gray("Tip: paste the key below — it starts with")} ${gray(provider.keyHint)}`);
        console.log();
        const keyInput = await prompt(rl, `  Paste API key: `);
        if (!keyInput.trim()) { console.log(red("  No key provided. Exiting.")); return; }
        config[providerId] = { apiKey: keyInput.trim(), model: provider.default };
      }

      // Model selection (just press Enter to keep default)
      const currentModel = config[providerId].model;
      console.log();
      console.log(`  ${gray("Available models:")} ${provider.models.join("  ")}`);
      const modelInput = await prompt(rl, `  Model [${currentModel}]: `);
      config[providerId].model = modelInput.trim() || currentModel;

      saveConfig(cwd, config);

      console.log();
      process.stdout.write(`  ${green("✓")} Saved. Testing connection…  `);

      const result = await testProvider(providerId, config, cwd);
      if (result?.text) {
        console.log(green("OK") + gray(` (${config[providerId].model})`));
      } else {
        console.log(yellow("no response"));
        console.log(`  ${yellow("⚠")}  Connection failed — double-check your API key.`);
      }
    }

    console.log();
    console.log(`  ${green("✓")} ${bold(provider.name)} is ready.`);
    console.log(`  ${gray("AI-powered commands:")}  explain  why  review  changelog`);
    console.log();

    // gitignore reminder
    const gitignorePath = path.join(cwd, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf8");
      if (!content.includes("integrations.json")) {
        console.log(`  ${yellow("⚠")}  Add ${cyan("inferno/integrations.json")} to your .gitignore to avoid committing your API key.`);
        console.log();
      }
    }

  } finally {
    rl.close();
  }
}

async function cmdTest(args, cwd) {
  const config     = loadConfig(cwd);
  const providerId = args.find(a => !a.startsWith("--")) || null;

  console.log();
  console.log(`  ${bold("infernoflow ai test")}`);
  console.log();

  const toTest = providerId
    ? PROVIDERS.filter(p => p.id === providerId)
    : PROVIDERS;

  for (const p of toTest) {
    const status = await checkProviderStatus(p.id, config);
    if (!status.configured) {
      console.log(`  ${gray("○")}  ${bold(p.name.padEnd(22))}  ${gray("not configured — skipping")}`);
      continue;
    }

    process.stdout.write(`  ${yellow("…")}  ${bold(p.name.padEnd(22))}  testing…  `);
    const result = await testProvider(p.id, config, cwd);
    if (result?.text) {
      console.log(green("OK") + gray(` (${result.model || p.id})`));
      console.log(`     ${gray(result.text.trim().slice(0, 80))}`);
    } else {
      console.log(red("FAIL"));
      console.log(`     ${red("No response — check API key or model name")}`);
    }
  }

  console.log();
}

async function cmdClear(args, cwd) {
  const config     = loadConfig(cwd);
  const providerId = args.find(a => !a.startsWith("--"));

  if (!providerId) {
    console.error(red("✗ Usage: infernoflow ai clear <provider>"));
    console.error(gray("  Example: infernoflow ai clear openai"));
    process.exit(1);
  }

  if (!config[providerId]) {
    console.log(gray(`  No config found for "${providerId}"`));
    return;
  }

  delete config[providerId];
  saveConfig(cwd, config);
  console.log(green(`  ✓ Cleared config for ${providerId}`));
}

// ── entry point ───────────────────────────────────────────────────────────────

export async function aiCommand(rawArgs) {
  const args    = (rawArgs || []).slice(1);
  const sub     = args.find(a => !a.startsWith("--")) || "status";
  const subArgs = args.filter(a => a !== sub);
  const cwd     = process.cwd();

  switch (sub) {
    case "setup":   return cmdSetup(cwd);
    case "status":  return cmdStatus(cwd);
    case "test":    return cmdTest(subArgs, cwd);
    case "clear":   return cmdClear(subArgs, cwd);
    default:
      console.error(red(`✗ Unknown subcommand: "${sub}"`));
      console.error(gray("  Usage: infernoflow ai <setup|status|test|clear>"));
      process.exit(1);
  }
}

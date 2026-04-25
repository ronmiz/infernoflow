/**
 * infernoflow AI provider router
 *
 * Tries providers in order until one works:
 *   Tier 1 — VS Code Language Model API (vscode.lm — any Copilot model: Gemini, Claude, GPT)
 *   Tier 2 — Direct API: Anthropic, OpenAI, Google AI (Gemini), OpenRouter
 *   Tier 3 — Ollama (local, free, offline)
 *   Tier 4 — Prompt fallback (print prompt, no AI call)
 *
 * Config sources (in priority order):
 *   1. Environment variables
 *   2. inferno/integrations.json
 *   3. Auto-detection (Ollama running locally, etc.)
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import * as https from "node:https";
import * as http  from "node:http";

// ── Config reader ─────────────────────────────────────────────────────────────

export function readAiConfig(cwd) {
  const p = path.join(cwd, "inferno", "integrations.json");
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === "https:" ? https : http;
    const data   = JSON.stringify(body);

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ""),
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
    }, (res) => {
      let raw = "";
      res.on("data", d => (raw += d));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Tier 2: Direct API providers ─────────────────────────────────────────────

async function callAnthropic(prompt, config) {
  const apiKey = process.env.ANTHROPIC_API_KEY || config.anthropic?.apiKey;
  if (!apiKey) return null;

  const model = config.anthropic?.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  try {
    const res = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      {
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }
    );
    if (res.status === 200 && res.body?.content?.[0]?.text) {
      return { text: res.body.content[0].text, provider: "anthropic", model };
    }
  } catch {}
  return null;
}

async function callOpenAI(prompt, config) {
  const apiKey   = process.env.OPENAI_API_KEY || config.openai?.apiKey;
  const endpoint = process.env.OPENAI_ENDPOINT || config.openai?.endpoint || "https://api.openai.com/v1/chat/completions";
  if (!apiKey) return null;

  const model = config.openai?.model || process.env.OPENAI_MODEL || "gpt-4o";

  try {
    const res = await post(
      endpoint,
      { "Authorization": `Bearer ${apiKey}` },
      {
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }
    );
    if (res.status === 200 && res.body?.choices?.[0]?.message?.content) {
      return { text: res.body.choices[0].message.content, provider: "openai", model };
    }
  } catch {}
  return null;
}

async function callGemini(prompt, config) {
  const apiKey = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || config.gemini?.apiKey;
  if (!apiKey) return null;

  const model = config.gemini?.model || process.env.GEMINI_MODEL || "gemini-2.0-flash";

  try {
    const res = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {},
      { contents: [{ parts: [{ text: prompt }] }] }
    );
    const text = res.body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (res.status === 200 && text) {
      return { text, provider: "gemini", model };
    }
  } catch {}
  return null;
}

async function callOpenRouter(prompt, config) {
  const apiKey = process.env.OPENROUTER_API_KEY || config.openrouter?.apiKey;
  if (!apiKey) return null;

  const model = config.openrouter?.model || process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4-6";

  try {
    const res = await post(
      "https://openrouter.ai/api/v1/chat/completions",
      { "Authorization": `Bearer ${apiKey}`, "HTTP-Referer": "https://infernoflow.dev" },
      {
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
      }
    );
    if (res.status === 200 && res.body?.choices?.[0]?.message?.content) {
      return { text: res.body.choices[0].message.content, provider: "openrouter", model };
    }
  } catch {}
  return null;
}

// ── Tier 3: Ollama (local) ────────────────────────────────────────────────────

async function callOllama(prompt, config) {
  const host  = process.env.OLLAMA_HOST || config.ollama?.host || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || config.ollama?.model || "llama3";

  // Quick liveness check
  try {
    await new Promise((res, rej) => {
      const u = new URL(host);
      http.get({ hostname: u.hostname, port: u.port || 11434, path: "/api/tags", timeout: 1500 },
        r => res(r)).on("error", rej);
    });
  } catch { return null; }

  try {
    const res = await post(
      `${host}/api/generate`,
      {},
      { model, prompt, stream: false }
    );
    if (res.status === 200 && res.body?.response) {
      return { text: res.body.response, provider: "ollama", model };
    }
  } catch {}
  return null;
}

// ── Main router ───────────────────────────────────────────────────────────────

/**
 * Call the best available AI provider with a prompt.
 *
 * @param {string} prompt  - The full prompt text
 * @param {object} opts
 *   opts.cwd      - Project root (for reading integrations.json)
 *   opts.provider - Force a specific provider: anthropic|openai|gemini|openrouter|ollama|prompt
 *   opts.silent   - Don't print "using provider X" message
 * @returns {{ text: string, provider: string, model: string } | null}
 *   null means no provider was available → caller should use prompt fallback
 */
export async function callAI(prompt, opts = {}) {
  const cwd      = opts.cwd || process.cwd();
  const config   = readAiConfig(cwd);
  const forced   = (opts.provider || "auto").toLowerCase();
  const silent   = opts.silent ?? true;

  const providers = [
    // Tier 2 — direct API (Tier 1 vscode.lm is handled in the VS Code extension)
    ["anthropic",   () => callAnthropic(prompt, config)],
    ["openai",      () => callOpenAI(prompt, config)],
    ["gemini",      () => callGemini(prompt, config)],
    ["openrouter",  () => callOpenRouter(prompt, config)],
    // Tier 3 — local
    ["ollama",      () => callOllama(prompt, config)],
  ];

  // If a specific provider is forced, only try that one
  const toTry = forced === "auto" || forced === "prompt"
    ? providers
    : providers.filter(([name]) => name === forced);

  for (const [name, fn] of toTry) {
    try {
      const result = await fn();
      if (result) {
        if (!silent) process.stderr.write(`  [infernoflow ai] using ${name}:${result.model}\n`);
        return result;
      }
    } catch {}
  }

  return null; // No provider → fallback to prompt output
}

/**
 * Detect which providers are configured (for doctor command).
 */
export function detectAvailableProviders(cwd) {
  const config = readAiConfig(cwd);
  return {
    anthropic:  !!(process.env.ANTHROPIC_API_KEY  || config.anthropic?.apiKey),
    openai:     !!(process.env.OPENAI_API_KEY      || config.openai?.apiKey),
    gemini:     !!(process.env.GOOGLE_AI_API_KEY   || process.env.GEMINI_API_KEY || config.gemini?.apiKey),
    openrouter: !!(process.env.OPENROUTER_API_KEY  || config.openrouter?.apiKey),
    ollama:     false, // checked async — doctor runs its own check
  };
}

/**
 * Resolve which provider + IDE is available for the `run` command.
 * Returns a structured object that run.mjs uses to decide how to proceed.
 *
 * @param {string} providerRequested - "auto"|"anthropic"|"openai"|etc.
 * @param {string} ideRequested      - "auto"|"vscode"|"cursor"|etc.
 * @returns {{ providerResolved: string, ideDetected: string, agentAvailable: boolean, reasonCodes: string[], error?: string }}
 */
export async function resolveProvider(providerRequested = "auto", ideRequested = "auto") {
  const cwd      = process.cwd();
  const config   = readAiConfig(cwd);
  const reasons  = [];

  // Detect IDE
  const inVsCode = !!process.env.VSCODE_PID || !!process.env.TERM_PROGRAM?.includes("vscode");
  const inCursor = !!process.env.CURSOR_TRACE_ID || !!process.env.CURSOR_CHANNEL;
  const ideDetected = inCursor ? "cursor" : inVsCode ? "vscode" : "terminal";

  // Detect available providers
  const available = {
    anthropic:  !!(process.env.ANTHROPIC_API_KEY  || config.anthropic?.apiKey),
    openai:     !!(process.env.OPENAI_API_KEY      || config.openai?.apiKey),
    gemini:     !!(process.env.GOOGLE_AI_API_KEY   || process.env.GEMINI_API_KEY || config.gemini?.apiKey),
    openrouter: !!(process.env.OPENROUTER_API_KEY  || config.openrouter?.apiKey),
    ollama:     false,
    vscode:     inVsCode || inCursor,
  };

  // Check Ollama quickly (sync port probe via env hint)
  if (process.env.OLLAMA_HOST || config.ollama?.host) {
    available.ollama = true;
    reasons.push("ollama_env");
  }

  // Resolve which provider to use
  let providerResolved = "none";
  const forced = (providerRequested || "auto").toLowerCase();

  if (forced !== "auto" && forced !== "prompt" && available[forced]) {
    providerResolved = forced;
    reasons.push(`forced_${forced}`);
  } else {
    // Priority order: vscode/cursor IDE → anthropic → openai → gemini → openrouter → ollama
    const priority = ["vscode", "anthropic", "openai", "gemini", "openrouter", "ollama"];
    for (const p of priority) {
      if (available[p]) { providerResolved = p; reasons.push(`auto_${p}`); break; }
    }
  }

  const agentAvailable = providerResolved !== "none";

  if (!agentAvailable) {
    reasons.push("no_provider");
    return { providerResolved: "none", ideDetected, agentAvailable: false, reasonCodes: reasons, error: "agent_unavailable" };
  }

  return { providerResolved, ideDetected, agentAvailable: true, reasonCodes: reasons };
}

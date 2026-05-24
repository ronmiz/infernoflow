const DEFAULT_TIMEOUT_MS = 45000;

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, timer };
}

async function callOllama(prompt, timeoutMs) {
  const endpoint = process.env.INFERNO_LOCAL_ENDPOINT || "http://127.0.0.1:11434/api/generate";
  const model = process.env.INFERNO_LOCAL_MODEL || "llama3.1:8b";
  const { controller, timer } = withTimeout(timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`local_model_http_${res.status}: ${body.slice(0, 240)}`);
    }
    const data = /** @type {{ response?: string }} */ (await res.json());
    if (!data?.response || typeof data.response !== "string") {
      throw new Error("local_model_invalid_response");
    }
    return data.response.trim();
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAICompat(prompt, timeoutMs) {
  const endpoint = process.env.INFERNO_LOCAL_ENDPOINT || "http://127.0.0.1:1234/v1/chat/completions";
  const model = process.env.INFERNO_LOCAL_MODEL || "local-model";
  const apiKey = process.env.INFERNO_LOCAL_API_KEY || "local";
  const { controller, timer } = withTimeout(timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: "Return JSON only." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`local_model_http_${res.status}: ${body.slice(0, 240)}`);
    }
    const data = /** @type {{ choices?: Array<{ message?: { content?: string } }> }} */ (await res.json());
    const text = data?.choices?.[0]?.message?.content;
    if (!text || typeof text !== "string") {
      throw new Error("local_model_invalid_response");
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function generateWithLocalModel(prompt, options = {}) {
  if (process.env.INFERNO_LOCAL_MOCK_RESPONSE) {
    return process.env.INFERNO_LOCAL_MOCK_RESPONSE;
  }

  const provider = (process.env.INFERNO_LOCAL_PROVIDER || "ollama").toLowerCase();
  const timeoutMs = Number(options.timeoutMs || process.env.INFERNO_LOCAL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  if (provider === "openai") {
    return callOpenAICompat(prompt, timeoutMs);
  }
  return callOllama(prompt, timeoutMs);
}


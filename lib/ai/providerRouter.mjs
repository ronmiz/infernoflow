import { detectIdeContext } from "./ideDetection.mjs";

export async function resolveProvider(requestedProvider = "auto", preferredIde = "auto") {
  const providerRequested = String(requestedProvider || "auto").toLowerCase();
  const ide = detectIdeContext(preferredIde);
  const reasonCodes = [...ide.reasonCodes];

  if (providerRequested === "local") {
    reasonCodes.push("LOCAL_PROVIDER_SELECTED");
    return {
      providerRequested,
      providerResolved: "local",
      ideDetected: ide.ideDetected,
      agentAvailable: ide.agentAvailable,
      reasonCodes,
    };
  }

  if (providerRequested === "prompt") {
    reasonCodes.push("PROMPT_PROVIDER_SELECTED");
    return {
      providerRequested,
      providerResolved: "prompt",
      ideDetected: ide.ideDetected,
      agentAvailable: ide.agentAvailable,
      reasonCodes,
    };
  }

  if (providerRequested === "agent") {
    if (!ide.agentAvailable) {
      reasonCodes.push("EXPLICIT_AGENT_REQUIRED");
      return {
        providerRequested,
        providerResolved: "none",
        ideDetected: ide.ideDetected,
        agentAvailable: ide.agentAvailable,
        reasonCodes,
        error: "agent_unavailable",
      };
    }
    reasonCodes.push("IDE_AGENT_SELECTED");
    return {
      providerRequested,
      providerResolved: "agent",
      ideDetected: ide.ideDetected,
      agentAvailable: ide.agentAvailable,
      reasonCodes,
    };
  }

  // auto
  if (ide.agentAvailable) {
    reasonCodes.push("IDE_AGENT_SELECTED");
    return {
      providerRequested: "auto",
      providerResolved: "agent",
      ideDetected: ide.ideDetected,
      agentAvailable: ide.agentAvailable,
      reasonCodes,
    };
  }

  reasonCodes.push("FALLBACK_PROMPT_MODE");
  return {
    providerRequested: "auto",
    providerResolved: "prompt",
    ideDetected: ide.ideDetected,
    agentAvailable: ide.agentAvailable,
    reasonCodes,
  };
}


/**
 * Return a map of supported AI providers and whether their API key env var is set.
 * Used by `infernoflow doctor` to surface which providers are wired up.
 *
 * @param {string} _cwd - currently unused; kept for forward-compat (config-file detection later)
 * @returns {Record<string, boolean>}
 */
export function detectAvailableProviders(_cwd) {
  return {
    anthropic:  Boolean(process.env.ANTHROPIC_API_KEY),
    openai:     Boolean(process.env.OPENAI_API_KEY),
    gemini:     Boolean(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  };
}

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


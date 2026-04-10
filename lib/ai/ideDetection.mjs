export function detectIdeContext(preferredIde = "auto") {
  const env = process.env;
  const lowerPreferred = String(preferredIde || "auto").toLowerCase();

  const hasCursor = !!(env.CURSOR_TRACE_ID || env.CURSOR_AGENT || env.CURSOR_SESSION_ID);
  const hasVscode = !!(env.VSCODE_PID || env.VSCODE_CWD || env.GITHUB_COPILOT_AGENT);
  const hasWindsurf = !!(env.WINDSURF || env.CODEIUM || env.WINDSURF_SESSION_ID);

  let ideDetected = "unknown";
  if (hasCursor) ideDetected = "cursor";
  else if (hasVscode) ideDetected = "vscode";
  else if (hasWindsurf) ideDetected = "windsurf";

  if (lowerPreferred !== "auto" && ["cursor", "vscode", "windsurf"].includes(lowerPreferred)) {
    ideDetected = lowerPreferred;
  }

  const explicitAgentAvailability = env.INFERNO_AGENT_AVAILABLE;
  const agentAvailable = explicitAgentAvailability != null
    ? explicitAgentAvailability === "1" || explicitAgentAvailability === "true"
    : ideDetected !== "unknown";

  const reasonCodes = [];
  if (ideDetected !== "unknown") reasonCodes.push(`IDE_${ideDetected.toUpperCase()}_DETECTED`);
  else reasonCodes.push("IDE_UNKNOWN");
  if (agentAvailable) reasonCodes.push("IDE_AGENT_AVAILABLE");
  else reasonCodes.push("IDE_AGENT_UNAVAILABLE");

  return { ideDetected, agentAvailable, reasonCodes };
}


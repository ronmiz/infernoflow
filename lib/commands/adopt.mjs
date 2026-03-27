import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

function toCapabilityId(raw) {
  return raw
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

function capTitle(id) {
  return id.replace(/([A-Z])/g, " $1").trim();
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

const HEURISTICS = [
  { id: "CreateItem", title: "Create Item", regex: /\b(post|create|add)\b/i },
  { id: "ReadItems", title: "Read Items", regex: /\b(get|read|list|fetch)\b/i },
  { id: "UpdateItem", title: "Update Item", regex: /\b(put|patch|update|edit)\b/i },
  { id: "DeleteItem", title: "Delete Item", regex: /\b(delete|remove)\b/i },
  { id: "SearchItems", title: "Search Items", regex: /\bsearch\b/i },
  { id: "FilterItems", title: "Filter Items", regex: /\bfilter\b/i },
  { id: "SetDueDate", title: "Set Due Date", regex: /\bdueDate|deadline|due\b/i },
  { id: "SetPriority", title: "Set Priority", regex: /\bpriority\b/i },
  { id: "ToggleComplete", title: "Toggle Complete", regex: /\bcomplete|completed|toggle\b/i },
  { id: "ClearCompleted", title: "Clear Completed", regex: /\bclearCompleted|clear completed\b/i },
];

export function discoverCapabilities(cwd) {
  const files = [];
  const roots = ["src", "server", "app", "backend", "frontend", "api"];
  for (const r of roots) {
    const root = path.join(cwd, r);
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
          stack.push(p);
        } else if (/\.(js|jsx|ts|tsx|mjs|cjs|json|md)$/.test(entry.name)) {
          files.push(p);
        }
      }
    }
  }

  const inferred = new Map();
  const addHit = (cap, filePath) => {
    if (!inferred.has(cap.id)) {
      inferred.set(cap.id, {
        id: cap.id,
        title: cap.title,
        reason: "Detected from code signals",
        sourceFiles: new Set(),
      });
    }
    inferred.get(cap.id).sourceFiles.add(path.relative(cwd, filePath));
  };

  for (const filePath of files) {
    const text = safeRead(filePath);
    for (const h of HEURISTICS) {
      if (h.regex.test(text)) {
        addHit(h, filePath);
      }
    }
  }

  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(safeRead(pkgPath) || "{}");
    const name = typeof pkg.name === "string" ? pkg.name : path.basename(cwd);
    const idHint = toCapabilityId(name);
    if (idHint && !inferred.size) {
      inferred.set("ReadItems", { id: "ReadItems", title: "Read Items", reason: `Fallback default for ${name}`, sourceFiles: new Set() });
      inferred.set("CreateItem", { id: "CreateItem", title: "Create Item", reason: `Fallback default for ${name}`, sourceFiles: new Set() });
    }
  }

  if (!inferred.size) {
    inferred.set("CreateItem", { id: "CreateItem", title: "Create Item", reason: "Fallback default", sourceFiles: new Set() });
    inferred.set("ReadItems", { id: "ReadItems", title: "Read Items", reason: "Fallback default", sourceFiles: new Set() });
  }

  return Array.from(inferred.values()).map((c) => ({
    ...c,
    sourceFiles: Array.from(c.sourceFiles || []),
  }));
}

export async function reviewCapabilitiesInteractive(capabilities, yes = false) {
  if (yes) return capabilities;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const list = capabilities.map((c) => c.id).join(", ");
  const answer = await new Promise((resolve) =>
    rl.question(`  Inferred capabilities (${list}). Press Enter to accept or type comma list: `, resolve)
  );
  rl.close();
  const trimmed = String(answer).trim();
  if (!trimmed) return capabilities;
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id, title: capTitle(id), reason: "User provided during adopt review" }));
}

export function buildAdoptionReport(capabilities) {
  if (!capabilities.length) return "No capabilities inferred.";
  const lines = ["Inferred capabilities report:"];
  for (const c of summarizeCapabilities(capabilities)) {
    lines.push(`- ${c.id} (${c.title})  [confidence: ${c.confidence}]`);
    if (c.signalCount > 0) {
      const sample = c.sourceFiles.slice(0, 3).join(", ");
      lines.push(`  sources: ${sample}`);
    } else {
      lines.push(`  sources: inferred fallback (no strong code signal)`);
    }
  }
  return lines.join("\n");
}

export function summarizeCapabilities(capabilities) {
  return capabilities.map((c) => {
    const hits = c.sourceFiles?.length || 0;
    const confidence = hits >= 3 ? "high" : hits >= 1 ? "medium" : "low";
    return {
      id: c.id,
      title: c.title,
      reason: c.reason,
      confidence,
      sourceFiles: c.sourceFiles || [],
      signalCount: hits,
    };
  });
}

export function writeAdoptionBaseline(infernoDir, policyId, capabilities) {
  const capIds = capabilities.map((c) => c.id);
  const contract = {
    policyId,
    policyVersion: 1,
    capabilities: capIds,
    rules: {
      docsRequiredOnCapabilityChange: true,
      requireScenarioForEachCapability: true,
      requireChangelogOnCapabilityChange: true,
    },
  };
  fs.mkdirSync(path.join(infernoDir, "scenarios"), { recursive: true });
  fs.writeFileSync(path.join(infernoDir, "contract.json"), JSON.stringify(contract, null, 2) + "\n");

  const registry = {
    schemaVersion: 1,
    capabilities: capabilities.map((c) => ({ id: c.id, title: c.title || capTitle(c.id), since: "0.1.0" })),
  };
  fs.writeFileSync(path.join(infernoDir, "capabilities.json"), JSON.stringify(registry, null, 2) + "\n");

  const scenario = {
    scenarioId: "adoption_baseline",
    description: "Baseline inferred from existing codebase during adoption",
    capabilitiesCovered: capIds,
    steps: capIds.map((id) => ({ action: id, expect: `${id} behavior exists in the current project` })),
  };
  fs.writeFileSync(path.join(infernoDir, "scenarios", "adoption_baseline.json"), JSON.stringify(scenario, null, 2) + "\n");

  const changelog = `# Changelog — ${policyId}

## Unreleased

- Adopted infernoflow into an existing project and generated baseline capabilities.

## 0.1.0 — Adoption baseline

- Initial baseline generated by infernoflow init --adopt
`;
  fs.writeFileSync(path.join(infernoDir, "CHANGELOG.md"), changelog, "utf8");
}

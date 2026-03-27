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
  return discoverProjectSignals(cwd).capabilities;
}

function collectCodeFiles(cwd) {
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
        } else if (/\.(js|jsx|ts|tsx|mjs|cjs|json|md|html|htm)$/.test(entry.name)) {
          files.push(p);
        }
      }
    }
  }
  return files;
}

function detectComponents(files, cwd) {
  const names = new Set();
  for (const filePath of files) {
    const rel = path.relative(cwd, filePath);
    const text = safeRead(filePath);
    const classMatches = text.matchAll(/\bclass\s+([A-Z][A-Za-z0-9_]*?(?:Component|Page|View|Widget|Card))\b/g);
    for (const m of classMatches) names.add(m[1]);
    const selectorMatches = text.matchAll(/\bselector\s*:\s*["']([^"']+)["']/g);
    for (const m of selectorMatches) names.add(m[1]);
    const reactFnMatches = text.matchAll(/\bfunction\s+([A-Z][A-Za-z0-9_]*)\s*\(/g);
    for (const m of reactFnMatches) {
      if (/component|page|view|card|chart|dashboard/i.test(m[1])) names.add(m[1]);
    }
    const relMatch = rel.match(/([^/\\]+)\.(component|page|view|widget|card)\.(ts|tsx|js|jsx)$/i);
    if (relMatch) names.add(relMatch[1]);
  }
  return Array.from(names).sort();
}

function detectDisplayFields(files) {
  const fields = new Set();
  const methodNames = new Set();
  const stopWords = new Set([
    "if", "for", "while", "const", "let", "var", "return", "function", "class", "import", "export",
    "null", "undefined", "true", "false", "string", "number", "boolean", "any", "unknown", "never",
    "selector", "templateUrl", "styleUrl", "standalone", "imports", "providers", "providedIn",
    "options", "scales", "responsive", "display", "title", "type", "label",
    "component", "service", "routes", "appConfig", "ApplicationConfig",
  ]);
  const add = (v) => {
    if (!v) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) return;
    if (v.length <= 1) return;
    if (stopWords.has(v)) return;
    if (/^[A-Z0-9_]+$/.test(v)) return;
    fields.add(v);
  };
  for (const filePath of files) {
    const text = safeRead(filePath);
    if (/\.(html|htm)$/i.test(filePath)) {
      const angularInterpolations = text.matchAll(/\{\{\s*(?:this\.)?([a-zA-Z_][a-zA-Z0-9_]*)/g);
      for (const m of angularInterpolations) add(m[1]);
      const ngModels = text.matchAll(/\[\(ngModel\)\]\s*=\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/g);
      for (const m of ngModels) add(m[1]);
      const ngInputs = text.matchAll(/\[[a-zA-Z0-9_-]+\]\s*=\s*["'](?:this\.)?([a-zA-Z_][a-zA-Z0-9_]*)["']/g);
      for (const m of ngInputs) add(m[1]);
      const ngIfs = text.matchAll(/\*ngIf\s*=\s*["'](?:this\.)?([a-zA-Z_][a-zA-Z0-9_]*)/g);
      for (const m of ngIfs) add(m[1]);
    }
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(filePath)) {
      const methodDecl = text.matchAll(
        /(?:^|\n)\s*(?:public|private|protected)?\s*(?:async\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*\{/g
      );
      for (const m of methodDecl) methodNames.add(m[1]);

      const thisRefs = text.matchAll(/\bthis\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g);
      for (const m of thisRefs) add(m[1]);

      const classProps = text.matchAll(
        /(?:^|\n)\s*(?:public|private|protected)?\s*(?:readonly\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::|=)/g
      );
      for (const m of classProps) {
        add(m[1]);
      }

      const inputProps = text.matchAll(/@Input\([^)]*\)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*[:=]/g);
      for (const m of inputProps) add(m[1]);

      const forEachParams = text.matchAll(/forEach\(\((\w+)\)\s*=>/g);
      for (const m of forEachParams) {
        const item = m[1];
        const propAccess = new RegExp(`\\b${item}\\.([a-zA-Z_][a-zA-Z0-9_]*)\\b`, "g");
        for (const p of text.matchAll(propAccess)) add(p[1]);
      }
    }
  }
  return Array.from(fields)
    .filter((name) => !methodNames.has(name))
    .sort()
    .slice(0, 80);
}

function detectExternalLibraries(cwd) {
  const libs = new Set();
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(safeRead(pkgPath) || "{}");
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const name of Object.keys(deps)) libs.add(name);
  } catch {}
  return Array.from(libs).sort();
}

function detectStyling(cwd, files, externalLibraries) {
  const styleFiles = files
    .filter((f) => /\.(css|scss|sass|less|styl)$/i.test(f))
    .map((f) => path.relative(cwd, f))
    .sort();

  const frameworks = [];
  const hasDep = (name) => externalLibraries.includes(name);
  if (hasDep("tailwindcss")) frameworks.push("Tailwind CSS");
  if (hasDep("bootstrap")) frameworks.push("Bootstrap");
  if (externalLibraries.some((lib) => lib.startsWith("@angular/material"))) frameworks.push("Angular Material");
  if (hasDep("antd")) frameworks.push("Ant Design");
  if (hasDep("styled-components")) frameworks.push("styled-components");
  if (hasDep("emotion") || hasDep("@emotion/react")) frameworks.push("Emotion");

  const tokenVars = new Set();
  for (const filePath of files) {
    if (!/\.(css|scss|sass|less|styl|html|htm|ts|tsx|js|jsx|mjs|cjs)$/i.test(filePath)) continue;
    const text = safeRead(filePath);
    for (const m of text.matchAll(/--([a-zA-Z][a-zA-Z0-9_-]*)/g)) tokenVars.add(`--${m[1]}`);
  }

  return {
    cssFrameworks: frameworks,
    styleFileCount: styleFiles.length,
    styleFilesSample: styleFiles.slice(0, 12),
    designTokens: Array.from(tokenVars).sort().slice(0, 24),
  };
}

function detectUiLayout(files) {
  let usesGrid = false;
  let usesFlex = false;
  const sections = new Set();

  for (const filePath of files) {
    if (!/\.(html|htm|tsx|jsx|ts|js|mjs|cjs)$/i.test(filePath)) continue;
    const text = safeRead(filePath);

    if (/\bgrid\b|grid-template|grid-cols-|display:\s*grid/i.test(text)) usesGrid = true;
    if (/\bflex\b|display:\s*flex|flex-row|flex-col|justify-|items-/i.test(text)) usesFlex = true;

    for (const m of text.matchAll(/<(main|header|footer|section|aside|nav)\b/gi)) {
      sections.add(m[1].toLowerCase());
    }
    for (const m of text.matchAll(/class(?:Name)?\s*=\s*["'`][^"'`]*(dashboard|chart|card|sidebar|content|toolbar|filter|panel|table)[^"'`]*["'`]/gi)) {
      const hit = m[1].toLowerCase();
      sections.add(hit === "filter" ? "filters" : hit);
    }
  }

  const layoutType = usesGrid && usesFlex ? "mixed" : usesGrid ? "grid" : usesFlex ? "flex" : "unknown";
  return {
    layoutType,
    usesGrid,
    usesFlex,
    sections: Array.from(sections).sort(),
  };
}

export function discoverProjectSignals(cwd) {
  const files = collectCodeFiles(cwd);
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

  const capabilities = Array.from(inferred.values()).map((c) => ({
    ...c,
    sourceFiles: Array.from(c.sourceFiles || []),
  }));
  const externalLibraries = detectExternalLibraries(cwd);
  return {
    capabilities,
    components: detectComponents(files, cwd),
    displayFields: detectDisplayFields(files),
    externalLibraries,
    uiLayout: detectUiLayout(files),
    styling: detectStyling(cwd, files, externalLibraries),
  };
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
  const summarized = summarizeCapabilities(capabilities);
  const totalSignals = summarized.reduce((acc, c) => acc + c.signalCount, 0);
  const byConfidence = {
    high: summarized.filter((c) => c.confidence === "high").length,
    medium: summarized.filter((c) => c.confidence === "medium").length,
    low: summarized.filter((c) => c.confidence === "low").length,
  };

  const lines = [];
  lines.push("Adoption Analysis");
  lines.push("=".repeat(56));
  lines.push(`Capabilities detected : ${summarized.length}`);
  lines.push(`Signal hits total     : ${totalSignals}`);
  lines.push(
    `Confidence mix        : high=${byConfidence.high}, medium=${byConfidence.medium}, low=${byConfidence.low}`
  );
  lines.push("-".repeat(56));
  lines.push("Capability Breakdown");
  lines.push("-".repeat(56));
  lines.push("Confidence  Signals  Capability");
  lines.push("-".repeat(56));
  for (const c of summarized) {
    const confidence = c.confidence.toUpperCase().padEnd(10, " ");
    const signals = String(c.signalCount).padEnd(7, " ");
    lines.push(`${confidence}  ${signals}  ${c.id} (${c.title})`);
    if (c.signalCount > 0) {
      const sample = c.sourceFiles.slice(0, 3).join(", ");
      lines.push(`  sources: ${sample}`);
      if (c.sourceFiles.length > 3) {
        lines.push(`  more   : +${c.sourceFiles.length - 3} additional files`);
      }
    } else {
      lines.push("  sources: inferred fallback (no strong code signal)");
    }
  }
  lines.push("=".repeat(56));
  return lines.join("\n");
}

export function buildSignalsReport(signals) {
  const formatList = (title, items, limit = 10) => {
    const lines = [`${title} (${items.length})`];
    lines.push("-".repeat(56));
    if (!items.length) {
      lines.push("  - none");
      return lines.join("\n");
    }
    for (const item of items.slice(0, limit)) {
      lines.push(`  - ${item}`);
    }
    if (items.length > limit) {
      lines.push(`  - ... +${items.length - limit} more`);
    }
    return lines.join("\n");
  };

  return [
    "Project Structure Signals",
    "=".repeat(56),
    formatList("Components", signals.components || []),
    formatList("Display fields", signals.displayFields || []),
    formatList("External libraries", signals.externalLibraries || []),
    "UI layout",
    "-".repeat(56),
    `  - layout type: ${signals.uiLayout?.layoutType || "unknown"}`,
    `  - uses grid : ${signals.uiLayout?.usesGrid ? "yes" : "no"}`,
    `  - uses flex : ${signals.uiLayout?.usesFlex ? "yes" : "no"}`,
    `  - sections  : ${(signals.uiLayout?.sections || []).slice(0, 10).join(", ") || "none"}`,
    "Styling",
    "-".repeat(56),
    `  - frameworks : ${(signals.styling?.cssFrameworks || []).join(", ") || "none detected"}`,
    `  - style files: ${signals.styling?.styleFileCount ?? 0}`,
    `  - tokens     : ${(signals.styling?.designTokens || []).slice(0, 8).join(", ") || "none detected"}`,
    "=".repeat(56),
  ].join("\n");
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

export function writeAdoptionBaseline(infernoDir, policyId, capabilities, signals = null) {
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

  if (signals) {
    const profile = {
      profileId: "adoption_profile",
      generatedAt: new Date().toISOString(),
      components: signals.components || [],
      displayFields: signals.displayFields || [],
      externalLibraries: signals.externalLibraries || [],
      uiLayout: signals.uiLayout || { layoutType: "unknown", usesGrid: false, usesFlex: false, sections: [] },
      styling: signals.styling || { cssFrameworks: [], styleFileCount: 0, styleFilesSample: [], designTokens: [] },
    };
    fs.writeFileSync(path.join(infernoDir, "adoption_profile.json"), JSON.stringify(profile, null, 2) + "\n");
  }

  const changelog = `# Changelog — ${policyId}

## Unreleased

- Adopted infernoflow into an existing project and generated baseline capabilities.
- Captured detected components, display fields, and external libraries in adoption profile.

## 0.1.0 — Adoption baseline

- Initial baseline generated by infernoflow init --adopt
`;
  fs.writeFileSync(path.join(infernoDir, "CHANGELOG.md"), changelog, "utf8");
}

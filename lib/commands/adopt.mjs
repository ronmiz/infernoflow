import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { seedProfileFromAdoption } from "../learning/profile.mjs";
import { scanAngular } from "../adopters/angular.mjs";
import { scanReact } from "../adopters/react.mjs";
import { scanCSS } from "../adopters/css.mjs";

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
  const roots = ["src", "server", "app", "backend", "frontend", "api", "Controllers"];
  for (const r of roots) {
    const root = path.join(cwd, r);
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop();
      for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, entry.name);
        if (entry.isDirectory()) {
          const SKIP_DIRS = new Set([
            "node_modules", ".git", "dist", "build", "out", "www", "tmp", ".tmp",
            "vendor", "assets", "public", "static", "coverage", ".nyc_output",
            ".angular", ".vite", ".cache", ".parcel-cache", ".next", ".nuxt",
            "__pycache__", "e2e", "test", "tests", "spec", "__tests__",
            "fixtures", "mocks", ".turbo", "storybook-static",
            // infernoflow's own scaffolding — without these, capability scan
            // attributes our MCP server and Cursor hooks to user domain
            // (e.g. .cursor/hooks/inferno-session-draft.mjs got mapped to a
            // ReadTasks capability). User code only, never our own files.
            ".cursor", ".vscode", ".claude", ".ai-memory", "inferno", "legacy",
          ]);
          if (SKIP_DIRS.has(entry.name)) continue;
          stack.push(p);
        } else if (/\.(js|jsx|ts|tsx|mjs|cjs|json|md|html|htm|cs|csproj)$/.test(entry.name)) {
          // Skip minified, bundled, and source-map files
          if (/\.(min|bundle)\.(js|css)$/.test(entry.name)) continue;
          if (/\.map$/.test(entry.name)) continue;
          // Skip generated Angular/framework files
          if (/\.(spec|test)\.(ts|js|tsx|jsx)$/.test(entry.name)) continue;
          // Skip infernoflow's own scripts that may live in the project root
          // (inferno-doc-gate, inferno-install-hooks, inferno-promote-draft, etc.)
          if (/^inferno-/.test(entry.name)) continue;
          files.push(p);
        }
      }
    }
  }
  // Include common root-level .NET entry files without scanning the whole repo.
  for (const entry of fs.readdirSync(cwd, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (/^(Program\.cs|.+\.csproj)$/i.test(entry.name)) {
      files.push(path.join(cwd, entry.name));
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

function detectDevelopmentProfile(cwd, files, externalLibraries, overrides = {}) {
  const extCount = { ts: 0, js: 0, py: 0, java: 0, go: 0, rb: 0, rs: 0, cs: 0, php: 0 };
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".ts" || ext === ".tsx") extCount.ts += 1;
    if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") extCount.js += 1;
    if (ext === ".py") extCount.py += 1;
    if (ext === ".java") extCount.java += 1;
    if (ext === ".go") extCount.go += 1;
    if (ext === ".rb") extCount.rb += 1;
    if (ext === ".rs") extCount.rs += 1;
    if (ext === ".cs") extCount.cs += 1;
    if (ext === ".php") extCount.php += 1;
  }

  const sortedLang = Object.entries(extCount).sort((a, b) => b[1] - a[1]);
  const autoLanguage = sortedLang[0]?.[1] > 0 ? sortedLang[0][0] : "unknown";

  let autoFramework = "unknown";
  let hasDotnetWebSdk = false;
  let hasMinimalApi = false;
  let hasBlazor = false;
  for (const filePath of files) {
    const base = path.basename(filePath).toLowerCase();
    if (base.endsWith(".csproj")) {
      const text = safeRead(filePath);
      if (/Microsoft\.NET\.Sdk\.Web/i.test(text)) hasDotnetWebSdk = true;
      if (/Blazor/i.test(text) || /Microsoft\.AspNetCore\.Components/i.test(text)) hasBlazor = true;
    }
    if (base === "program.cs") {
      const text = safeRead(filePath);
      if (/app\.Map(Get|Post|Put|Delete|Patch)\s*\(/i.test(text)) hasMinimalApi = true;
    }
  }
  const hasDep = (name) => externalLibraries.includes(name);
  if (externalLibraries.some((d) => d.startsWith("@angular/"))) autoFramework = "angular";
  else if (hasDep("react")) autoFramework = "react";
  else if (hasDep("vue")) autoFramework = "vue";
  else if (hasDep("svelte")) autoFramework = "svelte";
  else if (hasDep("next")) autoFramework = "nextjs";
  else if (hasDep("nuxt")) autoFramework = "nuxt";
  else if (hasDep("express")) autoFramework = "express";
  else if (hasDep("@nestjs/core")) autoFramework = "nestjs";
  else if (hasDep("fastify")) autoFramework = "fastify";
  else if (hasDep("flask")) autoFramework = "flask";
  else if (hasDep("django")) autoFramework = "django";
  else if (hasDep("spring-boot")) autoFramework = "spring";
  else if (hasBlazor) autoFramework = "blazor";
  else if (hasMinimalApi) autoFramework = "minimalapi";
  else if (hasDotnetWebSdk || extCount.cs > 0) autoFramework = "aspnet";

  let autoProjectType = "fullstack";
  const hasClientRoots = ["src", "frontend", "app"].some((d) => fs.existsSync(path.join(cwd, d)));
  const hasServerRoots = ["server", "backend", "api"].some((d) => fs.existsSync(path.join(cwd, d)));
  if (["react", "angular", "vue", "svelte", "nextjs", "nuxt"].includes(autoFramework)) autoProjectType = "frontend";
  if (["express", "nestjs", "fastify", "flask", "django", "spring", "aspnet", "minimalapi"].includes(autoFramework)) autoProjectType = "backend";
  if (hasClientRoots && hasServerRoots) autoProjectType = "fullstack";
  if (!hasClientRoots && !hasServerRoots) autoProjectType = "library";
  if (autoFramework === "blazor") autoProjectType = "frontend";

  return {
    language: overrides.language || autoLanguage,
    framework: overrides.framework || autoFramework,
    projectType: overrides.projectType || autoProjectType,
    detected: {
      language: autoLanguage,
      framework: autoFramework,
      projectType: autoProjectType,
    },
  };
}

function detectApiCalls(cwd, files) {
  const calls = [];
  const seen = new Set();
  const normalizeEndpointPattern = (value) => {
    let out = String(value || "").trim();
    if (!out) return "";
    out = out.replace(/https?:\/\/[^/]+/gi, "");
    out = out.replace(/\$\{[^}]+\}/g, "{var}");
    out = out.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, "{var}");
    out = out.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "{var}");
    out = out.replace(/\/\d+(?=\/|$)/g, "/{id}");
    out = out.replace(/=[^&\s]+/g, "={value}");
    out = out.replace(/\/+/g, "/");
    return out;
  };
  const addCall = (call) => {
    const endpointPattern = normalizeEndpointPattern(call.endpointPattern);
    if (!endpointPattern) return;
    const key = `${call.method}|${endpointPattern}|${call.sourceFile}|${call.style}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({ ...call, endpointPattern });
  };

  for (const filePath of files) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|cs)$/i.test(filePath)) continue;
    const rel = path.relative(cwd, filePath);
    const text = safeRead(filePath);
    const looksLikeService = /service|api|client|controller|program\.cs/i.test(rel) || /HttpClient|fetch\(|app\.Map(Get|Post|Put|Delete|Patch)\(/i.test(text);
    if (!looksLikeService) continue;

    const normalized = text.replace(/\r\n/g, "\n");

    const constStrings = {};
    const normalizeExpr = (expr) => {
      let out = String(expr || "").trim();
      if (!out) return "";
      out = out.replace(/;+$/, "").trim();
      out = out.replace(/\(\s*$/, ""); // e.g. "this._nextPage("
      // unwrap surrounding quotes/templates
      while ((out.startsWith("'") && out.endsWith("'")) || (out.startsWith('"') && out.endsWith('"')) || (out.startsWith("`") && out.endsWith("`"))) {
        out = out.slice(1, -1).trim();
      }
      return out;
    };
    const isLikelyEndpoint = (value) => {
      const v = String(value || "").trim();
      if (!v) return false;
      if (/^https?:\/\//i.test(v)) return true;
      if (v.startsWith("/")) return true;
      if (/\bapi\b/i.test(v)) return true;
      if (/\$\{[^}]+\}/.test(v)) return true;
      if (/\?[^=\s]+=?/.test(v)) return true;
      if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./${}-]+$/.test(v)) return true;
      return false;
    };
    const storeConst = (name, raw) => {
      if (!name || !raw) return;
      constStrings[name] = normalizeExpr(raw);
    };

    const constPattern = /(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*?);/g;
    for (const m of normalized.matchAll(constPattern)) {
      storeConst(m[1], m[2]);
    }
    const readonlyPattern =
      /(?:public|private|protected)?\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*?);/g;
    for (const m of normalized.matchAll(readonlyPattern)) {
      storeConst(m[1], m[2]);
    }

    const resolveExpr = (expr) => {
      const trimmed = normalizeExpr(expr);
      if (!trimmed) return "";
      if (/^['"`][\s\S]*['"`]$/.test(trimmed)) {
        return trimmed.replace(/^['"`]|['"`]$/g, "");
      }
      if (constStrings[trimmed] && isLikelyEndpoint(constStrings[trimmed])) return constStrings[trimmed];
      const thisRef = trimmed.match(/^this\.([A-Za-z_][A-Za-z0-9_]*)$/);
      if (thisRef && constStrings[thisRef[1]] && isLikelyEndpoint(constStrings[thisRef[1]])) return constStrings[thisRef[1]];
      const parts = trimmed.split("+").map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        const rebuilt = parts
          .map((p) => {
            if (/^['"`][\s\S]*['"`]$/.test(p)) return p.replace(/^['"`]|['"`]$/g, "");
            if (constStrings[p] && isLikelyEndpoint(constStrings[p])) return constStrings[p];
            const thisP = p.match(/^this\.([A-Za-z_][A-Za-z0-9_]*)$/);
            if (thisP && constStrings[thisP[1]] && isLikelyEndpoint(constStrings[thisP[1]])) return constStrings[thisP[1]];
            return `{${p}}`;
          })
          .join("");
        if (rebuilt) return rebuilt;
      }
      const ternary = trimmed.match(/^(.+?)\?(.+?):(.+)$/s);
      if (ternary) {
        const left = resolveExpr(ternary[2]);
        const right = resolveExpr(ternary[3]);
        if (left || right) return `${left || "{optionA}"} | ${right || "{optionB}"}`;
      }
      return trimmed;
    };

    const httpClientPattern =
      /\.\s*(get|post|put|patch|delete)\s*(?:<[\s\S]*?>)?\s*\(\s*([\s\S]*?)(?:,|\))/gi;
    for (const m of normalized.matchAll(httpClientPattern)) {
      const method = m[1].toUpperCase();
      const raw = resolveExpr(m[2]);
      if (!raw || !isLikelyEndpoint(raw)) continue;
      addCall({
        method,
        endpointPattern: raw,
        style: "httpClient",
        sourceFile: rel,
      });
    }

    const fetchPattern = /\bfetch\s*\(\s*([\s\S]*?)(?:,|\))/gi;
    for (const m of normalized.matchAll(fetchPattern)) {
      const firstArg = resolveExpr(m[1]);
      if (!firstArg || !isLikelyEndpoint(firstArg)) continue;
      const fromIdx = m.index || 0;
      const lookahead = normalized.slice(fromIdx, fromIdx + 260);
      const methodMatch = /method\s*:\s*["'](GET|POST|PUT|PATCH|DELETE)["']/i.exec(lookahead);
      const method = (methodMatch?.[1] || "GET").toUpperCase();
      addCall({
        method,
        endpointPattern: firstArg,
        style: "fetch",
        sourceFile: rel,
      });
    }

    const axiosPattern = /\baxios\.(get|post|put|patch|delete)\s*\(\s*([\s\S]*?)(?:,|\))/gi;
    for (const m of normalized.matchAll(axiosPattern)) {
      const method = m[1].toUpperCase();
      const endpoint = resolveExpr(m[2]);
      if (!endpoint || !isLikelyEndpoint(endpoint)) continue;
      addCall({
        method,
        endpointPattern: endpoint,
        style: "axios",
        sourceFile: rel,
      });
    }

    const axiosObjPattern = /\baxios\s*\(\s*\{([\s\S]*?)\}\s*\)/gi;
    for (const m of normalized.matchAll(axiosObjPattern)) {
      const body = m[1];
      const methodMatch = /\bmethod\s*:\s*["']?(get|post|put|patch|delete)["']?/i.exec(body);
      const urlMatch = /\burl\s*:\s*([^,\n]+)/i.exec(body);
      const method = (methodMatch?.[1] || "get").toUpperCase();
      const endpoint = resolveExpr(urlMatch?.[1] || "");
      if (!endpoint || !isLikelyEndpoint(endpoint)) continue;
      addCall({
        method,
        endpointPattern: endpoint,
        style: "axios-config",
        sourceFile: rel,
      });
    }

    const requestPattern = /\.\s*request\s*\(\s*["'](GET|POST|PUT|PATCH|DELETE)["']\s*,\s*([\s\S]*?)(?:,|\))/gi;
    for (const m of normalized.matchAll(requestPattern)) {
      const method = m[1].toUpperCase();
      const endpoint = resolveExpr(m[2]);
      if (!endpoint || !isLikelyEndpoint(endpoint)) continue;
      addCall({
        method,
        endpointPattern: endpoint,
        style: "request",
        sourceFile: rel,
      });
    }

    if (/\.cs$/i.test(filePath)) {
      const mapPattern = /\bapp\.Map(Get|Post|Put|Delete|Patch)\s*\(\s*"([^"]+)"/gi;
      for (const m of normalized.matchAll(mapPattern)) {
        addCall({
          method: m[1].toUpperCase(),
          endpointPattern: m[2],
          style: "csharp-map",
          sourceFile: rel,
        });
      }

      const classRouteMatch = /\[Route\("([^"]+)"\)\][\s\S]*?class\s+\w+/i.exec(normalized);
      const classRoute = classRouteMatch ? classRouteMatch[1] : "";
      const attrPattern = /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch)(?:\("([^"]*)"\))?\]/gi;
      for (const m of normalized.matchAll(attrPattern)) {
        const method = m[1].replace("Http", "").toUpperCase();
        const attrRoute = m[2] || "";
        const endpoint = [classRoute, attrRoute].filter(Boolean).join("/").replace(/\/+/g, "/").replace(/\[controller\]/gi, "{controller}");
        addCall({
          method,
          endpointPattern: endpoint || classRoute || "{controller-route}",
          style: "csharp-controller",
          sourceFile: rel,
        });
      }

      const httpClientPattern = /\b(GetAsync|PostAsync|PutAsync|DeleteAsync|SendAsync)\s*\(\s*"([^"]+)"/gi;
      for (const m of normalized.matchAll(httpClientPattern)) {
        const method = m[1].replace("Async", "").replace("Send", "SEND").toUpperCase();
        addCall({
          method,
          endpointPattern: m[2],
          style: "csharp-httpclient",
          sourceFile: rel,
        });
      }
    }
  }

  const byMethod = calls.reduce((acc, c) => {
    acc[c.method] = (acc[c.method] || 0) + 1;
    return acc;
  }, {});

  return {
    totalCalls: calls.length,
    byMethod,
    calls: calls.slice(0, 80),
  };
}

export function discoverProjectSignals(cwd, profileOverrides = {}) {
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

  const externalLibraries = detectExternalLibraries(cwd);
  const devProfile = detectDevelopmentProfile(cwd, files, externalLibraries, profileOverrides);

  // ── Framework-specific scanners ─────────────────────────────────────────
  let frameworkCapabilities = [];
  try {
    if (devProfile.framework === "angular") {
      const angularSignals = scanAngular(cwd, files);
      for (const cap of angularSignals.capabilities) {
        if (!inferred.has(cap.id)) {
          inferred.set(cap.id, { ...cap, sourceFiles: new Set(cap.sourceFiles) });
        }
      }
    } else if (devProfile.framework === "react" || devProfile.framework === "nextjs") {
      const reactSignals = scanReact(cwd, files);
      for (const cap of reactSignals.capabilities) {
        if (!inferred.has(cap.id)) {
          inferred.set(cap.id, { ...cap, sourceFiles: new Set(cap.sourceFiles) });
        }
      }
    }
  } catch {}

  // ── CSS signals ─────────────────────────────────────────────────────────
  let cssSignals = { designTokens: [], colorTokens: [], spacingTokens: [], componentClasses: [], themeVars: [] };
  try { cssSignals = scanCSS(cwd, files); } catch {}

  const capabilities = Array.from(inferred.values()).map((c) => ({
    ...c,
    sourceFiles: Array.from(c.sourceFiles || []),
  }));
  return {
    capabilities,
    components: detectComponents(files, cwd),
    displayFields: detectDisplayFields(files),
    externalLibraries,
    uiLayout: detectUiLayout(files),
    styling: {
      ...detectStyling(cwd, files, externalLibraries),
      // Merge in richer CSS scanner results
      designTokens: cssSignals.designTokens.length > 0 ? cssSignals.designTokens : undefined,
      colorTokens: cssSignals.colorTokens,
      spacingTokens: cssSignals.spacingTokens,
      componentClasses: cssSignals.componentClasses,
      themeVars: cssSignals.themeVars,
    },
    developmentProfile: devProfile,
    apiCalls: detectApiCalls(cwd, files),
  };
}

/**
 * Returns inferred capabilities as-is. Used to be an interactive prompt asking
 * for a comma-separated list, but that was friction users can't realistically
 * answer at init time — capabilities emerge during work, not before. Removed
 * in v0.43.6 per the ONE-thing focus pivot. Refine inferno/capabilities.json
 * directly after init if you want.
 */
export async function reviewCapabilitiesInteractive(capabilities, yes = false) {
  void yes;
  if (capabilities && capabilities.length > 0) {
    const list = capabilities.map((c) => c.id).join(", ");
    console.log(`  Inferred capabilities: ${list}`);
    console.log(`  (edit inferno/capabilities.json later if you want to refine)`);
  }
  return capabilities;
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
    "Development profile",
    "-".repeat(56),
    `  - language    : ${signals.developmentProfile?.language || "unknown"} (auto: ${signals.developmentProfile?.detected?.language || "unknown"})`,
    `  - framework   : ${signals.developmentProfile?.framework || "unknown"} (auto: ${signals.developmentProfile?.detected?.framework || "unknown"})`,
    `  - project type: ${signals.developmentProfile?.projectType || "unknown"} (auto: ${signals.developmentProfile?.detected?.projectType || "unknown"})`,
    "API calls",
    "-".repeat(56),
    `  - total calls : ${signals.apiCalls?.totalCalls ?? 0}`,
    `  - by method   : ${Object.entries(signals.apiCalls?.byMethod || {}).map(([k, v]) => `${k}:${v}`).join(", ") || "none"}`,
    ...(signals.apiCalls?.calls || []).slice(0, 6).map((c) => `  - ${c.method} ${c.endpointPattern} [${c.style}] (${c.sourceFile})`),
    ...((signals.apiCalls?.calls || []).length > 6
      ? [`  - ... +${(signals.apiCalls?.calls || []).length - 6} more`]
      : []),
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

/**
 * Build the ui section of contract.json from adoption signals.
 */
export function buildUiContractSection(signals) {
  if (!signals) return null;
  const components = [
    ...(signals.components || []),
  ].filter(Boolean).slice(0, 40);

  const designTokens = (signals.styling?.designTokens || []).slice(0, 20);
  const layout = signals.uiLayout?.layoutType || "unknown";
  const sections = (signals.uiLayout?.sections || []).slice(0, 12);
  const cssFrameworks = signals.styling?.cssFrameworks || [];
  const colorTokens = (signals.styling?.colorTokens || []).slice(0, 10);
  const themeVars = (signals.styling?.themeVars || []).slice(0, 10);

  return {
    components,
    designTokens,
    colorTokens,
    themeVars,
    cssFrameworks,
    layout,
    sections,
    lastScanned: new Date().toISOString(),
  };
}

/**
 * Merge a fresh ui scan result into an existing contract's ui section.
 * Preserves manually added entries, updates detected ones.
 */
export function mergeUiSection(existing, fresh) {
  if (!fresh) return existing;
  if (!existing) return fresh;
  return {
    ...fresh,
    // Keep any manually added components not in the fresh scan
    components: [...new Set([...(fresh.components || []), ...(existing.components || [])])].slice(0, 50),
    designTokens: [...new Set([...(fresh.designTokens || []), ...(existing.designTokens || [])])].slice(0, 30),
  };
}

export function writeAdoptionBaseline(infernoDir, policyId, capabilities, signals = null) {
  const capIds = capabilities.map((c) => c.id);
  const uiSection = buildUiContractSection(signals);

  const contract = {
    policyId,
    policyVersion: 1,
    capabilities: capIds,
    rules: {
      docsRequiredOnCapabilityChange: true,
      requireScenarioForEachCapability: true,
      requireChangelogOnCapabilityChange: true,
    },
    ...(uiSection ? { ui: uiSection } : {}),
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
      developmentProfile: signals.developmentProfile || {
        language: "unknown",
        framework: "unknown",
        projectType: "unknown",
        detected: { language: "unknown", framework: "unknown", projectType: "unknown" },
      },
      apiCalls: signals.apiCalls || { totalCalls: 0, byMethod: {}, calls: [] },
    };
    fs.writeFileSync(path.join(infernoDir, "adoption_profile.json"), JSON.stringify(profile, null, 2) + "\n");

    // Seed developer-profile.json from adoption signals
    try {
      seedProfileFromAdoption(infernoDir, signals, capabilities);
    } catch {}
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

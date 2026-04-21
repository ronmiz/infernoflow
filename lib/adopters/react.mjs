/**
 * lib/adopters/react.mjs
 * React-specific scanner for --adopt.
 * Detects components, hooks, routes, and UI capabilities from React projects.
 */

import * as fs from "node:fs";
import * as path from "node:path";

function safeRead(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}

/**
 * Scan a React project's source files for UI signals.
 *
 * Returns:
 * {
 *   components: string[],
 *   customHooks: string[],
 *   routes: string[],
 *   capabilities: { id, title, reason, sourceFiles }[]
 * }
 */
export function scanReact(cwd, files) {
  const components = new Set();
  const customHooks = new Set();
  const routes = new Set();
  const capabilityMap = new Map();

  const addCap = (id, title, reason, filePath) => {
    if (!capabilityMap.has(id)) {
      capabilityMap.set(id, { id, title, reason, sourceFiles: new Set() });
    }
    capabilityMap.get(id).sourceFiles.add(path.relative(cwd, filePath));
  };

  for (const filePath of files) {
    if (!/\.(tsx?|jsx?)$/.test(filePath)) continue;
    const text = safeRead(filePath);
    if (!text) continue;

    // ── Component detection ───────────────────────────────────────────────
    // export default function MyComponent / export function MyComponent
    const exportFn = text.matchAll(/export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g);
    for (const m of exportFn) {
      components.add(m[1]);
      // Page/View/Screen/Dashboard components → ViewXxx capability
      if (/Page|View|Screen|Dashboard|Panel|Modal|Dialog/i.test(m[1])) {
        const capId = "View" + m[1].replace(/(Page|View|Screen|Dashboard|Panel|Modal|Dialog)$/, "");
        addCap(capId, `View ${m[1].replace(/([A-Z])/g, " $1").trim()}`, `React component: ${m[1]}`, filePath);
      }
    }

    // Arrow function components: const MyComponent = () =>
    const arrowComp = text.matchAll(/(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:React\.memo\()?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/g);
    for (const m of arrowComp) {
      components.add(m[1]);
    }

    // ── Custom hooks ─────────────────────────────────────────────────────
    const hookMatches = text.matchAll(/export\s+(?:default\s+)?function\s+(use[A-Z][A-Za-z0-9_]*)\s*\(/g);
    for (const m of hookMatches) customHooks.add(m[1]);

    const hookArrow = text.matchAll(/(?:export\s+)?const\s+(use[A-Z][A-Za-z0-9_]*)\s*=/g);
    for (const m of hookArrow) customHooks.add(m[1]);

    // ── Route detection (react-router) ────────────────────────────────────
    // <Route path="/some/path"  or  path: "/some/path"
    const routeJsx = text.matchAll(/<Route[^>]+path\s*=\s*["'`]([^"'`]+)["'`]/g);
    for (const m of routeJsx) {
      const p = m[1].replace(/^\//, "").replace(/:[\w]+/g, "{id}");
      if (p) routes.add(p);
    }

    const routeObj = text.matchAll(/path\s*:\s*["'`]([^"'`]+)["'`]/g);
    for (const m of routeObj) {
      const p = m[1].replace(/^\//, "").replace(/:[\w]+/g, "{id}");
      if (p && p !== "*" && p.length < 60) routes.add(p);
    }

    // ── Button / action detection ─────────────────────────────────────────
    const onClicks = text.matchAll(/onClick\s*=\s*\{(?:[^}]*\b(delete|remove|create|add|submit|save|search|filter|toggle|update|edit)\b[^}]*)\}/gi);
    for (const m of onClicks) {
      const action = m[1].toLowerCase();
      if (action === "delete" || action === "remove") addCap("DeleteItem", "Delete Item", `onClick handler contains "${action}"`, filePath);
      if (action === "create" || action === "add")    addCap("CreateItem", "Create Item", `onClick handler contains "${action}"`, filePath);
      if (action === "submit" || action === "save" || action === "update" || action === "edit") addCap("UpdateItem", "Update Item", `onClick handler contains "${action}"`, filePath);
      if (action === "search") addCap("SearchItems", "Search Items", `onClick handler contains "search"`, filePath);
      if (action === "filter") addCap("FilterItems", "Filter Items", `onClick handler contains "filter"`, filePath);
      if (action === "toggle") addCap("ToggleComplete", "Toggle Complete", `onClick handler contains "toggle"`, filePath);
    }
  }

  return {
    components: Array.from(components).sort(),
    customHooks: Array.from(customHooks).sort(),
    routes: Array.from(routes).sort(),
    capabilities: Array.from(capabilityMap.values()).map(c => ({
      ...c,
      sourceFiles: Array.from(c.sourceFiles),
    })),
  };
}

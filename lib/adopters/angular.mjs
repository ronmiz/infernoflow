/**
 * lib/adopters/angular.mjs
 * Angular-specific scanner for --adopt.
 * Detects components, routes, services, and UI capabilities from Angular projects.
 */

import * as fs from "node:fs";
import * as path from "node:path";

function safeRead(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}

/**
 * Scan an Angular project's source files and return detected signals.
 *
 * Returns:
 * {
 *   components: string[],         // component class names
 *   routes: string[],             // route paths detected
 *   services: string[],           // service class names
 *   lazyModules: string[],        // lazy-loaded module paths
 *   formFields: string[],         // reactive form control names
 *   capabilities: { id, title, reason, sourceFiles }[]
 * }
 */
export function scanAngular(cwd, files) {
  const components = new Set();
  const routes = new Set();
  const services = new Set();
  const lazyModules = new Set();
  const formFields = new Set();
  const capabilityMap = new Map(); // capId → { id, title, reason, sourceFiles: Set }

  const addCap = (id, title, reason, filePath) => {
    if (!capabilityMap.has(id)) {
      capabilityMap.set(id, { id, title, reason, sourceFiles: new Set() });
    }
    capabilityMap.get(id).sourceFiles.add(path.relative(cwd, filePath));
  };

  for (const filePath of files) {
    const rel = path.relative(cwd, filePath).replace(/\\/g, "/");
    const text = safeRead(filePath);
    if (!text) continue;

    // ── Component detection ───────────────────────────────────────────────
    if (/\.(ts)$/.test(filePath)) {
      // @Component decorated classes
      const compMatches = text.matchAll(/@Component\s*\([^)]*\)[\s\S]*?class\s+([A-Z][A-Za-z0-9_]*Component)/g);
      for (const m of compMatches) {
        const name = m[1].replace(/Component$/, "");
        components.add(name);
        // Derive a capability from the component name
        const capId = name.endsWith("Page") || name.endsWith("View")
          ? `View${name.replace(/(Page|View)$/, "")}`
          : `View${name}`;
        addCap(capId, `View ${name.replace(/([A-Z])/g, " $1").trim()}`, `@Component class detected: ${m[1]}`, filePath);
      }

      // Service classes → often wrap API capabilities
      const svcMatches = text.matchAll(/@Injectable[\s\S]*?class\s+([A-Z][A-Za-z0-9_]*Service)/g);
      for (const m of svcMatches) {
        services.add(m[1]);
      }

      // Reactive form controls → hint at form-based capabilities
      const formGroups = text.matchAll(/FormBuilder|FormGroup|FormControl/g);
      if ([...formGroups].length > 0) {
        const controlNames = text.matchAll(/['"]([a-zA-Z][a-zA-Z0-9_]*)['"]:\s*(?:this\.\w+\.control|new FormControl|\[)/g);
        for (const m of controlNames) formFields.add(m[1]);
      }
    }

    // ── Route detection ───────────────────────────────────────────────────
    if (rel.includes("routing") || rel.includes("routes") || rel.endsWith("app.routes.ts")) {
      // path: 'some/route'
      const pathMatches = text.matchAll(/\bpath\s*:\s*['"`]([^'"`]+)['"`]/g);
      for (const m of pathMatches) {
        const routePath = m[1].trim();
        if (routePath && routePath !== "**" && !routePath.startsWith(":")) {
          routes.add(routePath);
          // Each top-level route = likely a view capability
          const parts = routePath.split("/").filter(Boolean);
          if (parts.length >= 1) {
            const name = parts[parts.length - 1];
            const capId = "View" + name.charAt(0).toUpperCase() + name.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            const title = "View " + name.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
            addCap(capId, title, `Route detected: /${routePath}`, filePath);
          }
        }
      }

      // Lazy-loaded modules
      const lazyMatches = text.matchAll(/loadChildren\s*:\s*\(\s*\)\s*=>\s*import\s*\(['"`]([^'"`]+)['"`]\)/g);
      for (const m of lazyMatches) lazyModules.add(m[1]);
    }

    // ── Template-based capability detection (.html) ───────────────────────
    if (/\.html$/.test(filePath)) {
      // Router links hint at navigation capabilities
      const routerLinks = text.matchAll(/routerLink\s*=\s*['"`]([^'"`]+)['"`]/g);
      for (const m of routerLinks) routes.add(m[1].replace(/^\//, ""));

      // (click) event bindings → actions
      const clickHandlers = text.matchAll(/\(click\)\s*=\s*["']([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g);
      for (const m of clickHandlers) {
        const handler = m[1];
        // Heuristic: delete/remove/create handlers → capabilities
        if (/delete|remove/i.test(handler)) addCap("DeleteItem", "Delete Item", `(click) handler: ${handler}`, filePath);
        if (/create|add|new/i.test(handler))  addCap("CreateItem", "Create Item", `(click) handler: ${handler}`, filePath);
        if (/submit|save/i.test(handler))      addCap("UpdateItem", "Update Item", `(click) handler: ${handler}`, filePath);
      }
    }
  }

  return {
    components: Array.from(components).sort(),
    routes: Array.from(routes).sort(),
    services: Array.from(services).sort(),
    lazyModules: Array.from(lazyModules).sort(),
    formFields: Array.from(formFields).sort(),
    capabilities: Array.from(capabilityMap.values()).map(c => ({
      ...c,
      sourceFiles: Array.from(c.sourceFiles),
    })),
  };
}

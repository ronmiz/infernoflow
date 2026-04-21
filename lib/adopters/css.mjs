/**
 * lib/adopters/css.mjs
 * CSS / SCSS / design token scanner for --adopt.
 * Extracts design tokens, component class names, and UI patterns.
 */

import * as fs from "node:fs";
import * as path from "node:path";

function safeRead(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return ""; }
}

/**
 * Scan CSS/SCSS/style files for design tokens and UI signals.
 *
 * Returns:
 * {
 *   designTokens: string[],      // CSS custom properties (--var-name)
 *   colorTokens: string[],       // tokens that look like colors
 *   spacingTokens: string[],     // tokens that look like spacing
 *   componentClasses: string[],  // BEM-style or component-level class names
 *   themeVars: string[],         // theme-related variables
 * }
 */
export function scanCSS(cwd, files) {
  const allTokens = new Set();
  const colorTokens = new Set();
  const spacingTokens = new Set();
  const componentClasses = new Set();
  const themeVars = new Set();

  const styleFiles = files.filter(f =>
    /\.(css|scss|sass|less|styl)$/.test(f) ||
    // Also scan JS/TS files for CSS-in-JS (styled-components, emotion)
    (/\.(ts|tsx|js|jsx)$/.test(f) && !f.includes("node_modules"))
  );

  for (const filePath of styleFiles) {
    const text = safeRead(filePath);
    if (!text) continue;

    // ── CSS custom properties (design tokens) ─────────────────────────────
    const tokenMatches = text.matchAll(/--([a-zA-Z][a-zA-Z0-9_-]*)\s*:/g);
    for (const m of tokenMatches) {
      const token = `--${m[1]}`;
      allTokens.add(token);

      // Classify by name
      if (/color|colour|bg|background|text|border|shadow|fill|stroke/i.test(m[1])) {
        colorTokens.add(token);
      } else if (/space|spacing|gap|padding|margin|size|radius|width|height/i.test(m[1])) {
        spacingTokens.add(token);
      } else if (/theme|primary|secondary|accent|brand|dark|light/i.test(m[1])) {
        themeVars.add(token);
      }
    }

    // ── CSS class names → component hints ────────────────────────────────
    if (/\.(css|scss|sass|less)$/.test(filePath)) {
      // BEM block names: .my-component { }
      const classMatches = text.matchAll(/^\s*\.([a-zA-Z][a-zA-Z0-9_-]*)[\s{,]/gm);
      for (const m of classMatches) {
        const cls = m[1];
        // Skip utility classes (short names, numbers, state classes)
        if (cls.length < 4) continue;
        if (/^(flex|grid|block|hidden|text|font|bg|border|p-|m-|w-|h-)/.test(cls)) continue;
        if (/^(active|disabled|hover|focus|error|success|warning)$/.test(cls)) continue;
        componentClasses.add(cls);
      }
    }

    // ── CSS-in-JS: styled-components / emotion ────────────────────────────
    if (/\.(ts|tsx|js|jsx)$/.test(filePath)) {
      // styled.div`...` or styled(Component)`...`
      const styledMatches = text.matchAll(/(?:styled|css)`[^`]*--([a-zA-Z][a-zA-Z0-9_-]*)\s*:/g);
      for (const m of styledMatches) allTokens.add(`--${m[1]}`);

      // Tailwind arbitrary values referencing CSS vars: bg-[--color-primary]
      const tailwindVars = text.matchAll(/\[--([a-zA-Z][a-zA-Z0-9_-]*)\]/g);
      for (const m of tailwindVars) allTokens.add(`--${m[1]}`);
    }
  }

  return {
    designTokens: Array.from(allTokens).sort().slice(0, 40),
    colorTokens: Array.from(colorTokens).sort().slice(0, 20),
    spacingTokens: Array.from(spacingTokens).sort().slice(0, 15),
    componentClasses: Array.from(componentClasses).sort().slice(0, 30),
    themeVars: Array.from(themeVars).sort().slice(0, 15),
  };
}

/**
 * Detect which CSS framework is in use from class names and package deps.
 */
export function detectCSSFramework(text, externalLibraries = []) {
  const hasDep = (name) => externalLibraries.includes(name);
  const hasClass = (pattern) => pattern.test(text);

  if (hasDep("tailwindcss") || hasClass(/\b(?:flex|grid|px-\d|py-\d|text-\w+|bg-\w+|rounded)/)) return "tailwind";
  if (hasDep("bootstrap") || hasClass(/\b(?:container|row|col-|btn btn-|navbar|card)/)) return "bootstrap";
  if (externalLibraries.some(d => d.startsWith("@angular/material"))) return "angular-material";
  if (hasDep("antd") || hasClass(/\bant-/)) return "ant-design";
  if (hasDep("@mui/material") || hasDep("@material-ui/core")) return "mui";
  if (hasDep("styled-components")) return "styled-components";
  if (hasDep("@emotion/react") || hasDep("@emotion/styled")) return "emotion";
  if (hasDep("@chakra-ui/react")) return "chakra-ui";
  if (hasDep("@radix-ui/react-primitive")) return "radix-ui";
  return "unknown";
}

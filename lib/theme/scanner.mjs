/**
 * infernoflow theme scanner
 *
 * Extracts fonts, colors, CSS variables, and framework info
 * from CSS, SCSS, CSS-in-JS, Tailwind config, and HTML files.
 *
 * Captures what AI can't reliably infer from scattered style files —
 * the actual design system: palette, typography, spacing tokens.
 */

import * as fs   from "node:fs";
import * as path from "node:path";

// ── File discovery ────────────────────────────────────────────────────────────

const STYLE_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less", ".styl"]);
const JS_EXTENSIONS    = new Set([".js", ".mjs", ".jsx", ".ts", ".tsx"]);
const SKIP_DIRS        = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".cache"]);

function walkDir(dir, maxDepth = 6, depth = 0) {
  if (depth > maxDepth) return [];
  let files = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(walkDir(full, maxDepth, depth + 1));
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  } catch {}
  return files;
}

// ── Color extraction ──────────────────────────────────────────────────────────

const HEX_RE    = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const RGB_RE    = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)/g;
const HSL_RE    = /hsla?\(\s*(\d{1,3})\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)/g;

// Colors to ignore — common resets, white/black, etc.
const SKIP_COLORS = new Set([
  "#000", "#000000", "#fff", "#ffffff", "#transparent",
  "#333", "#666", "#999", "#ccc", "#eee",
]);

function normalizeHex(hex) {
  if (hex.length === 4) {
    return "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  return hex.toLowerCase();
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(v => parseInt(v).toString(16).padStart(2, "0")).join("");
}

function extractColors(text) {
  const freq = {};

  for (const m of text.matchAll(HEX_RE)) {
    const hex = normalizeHex(m[0]);
    if (!SKIP_COLORS.has(hex)) freq[hex] = (freq[hex] || 0) + 1;
  }

  for (const m of text.matchAll(RGB_RE)) {
    const hex = rgbToHex(m[1], m[2], m[3]);
    if (!SKIP_COLORS.has(hex)) freq[hex] = (freq[hex] || 0) + 1;
  }

  return freq;
}

// ── Font extraction ───────────────────────────────────────────────────────────

const FONT_FAMILY_RE    = /font-family\s*:\s*([^;}{]+)/gi;
const FONT_FACE_RE      = /@font-face\s*\{[^}]*font-family\s*:\s*['"]?([^'";]+)['"]?/gi;
const GOOGLE_FONT_RE    = /fonts\.googleapis\.com\/css[^"']*family=([^"'&]+)/gi;
const NEXT_FONT_RE      = /from\s+['"]next\/font['"]\s*.*?{\s*([A-Z][a-zA-Z_]+)\s*}/gs;
const IMPORT_FONT_RE    = /import\s+\{([^}]+)\}\s+from\s+['"]@fontsource\/([^'"]+)['"]/g;

function cleanFontName(raw) {
  return raw.split(",")[0].trim().replace(/['"]/g, "").replace(/\s+/g, " ").trim();
}

function extractFonts(text, filePath) {
  const fonts = new Set();
  const sources = new Set();

  for (const m of text.matchAll(FONT_FAMILY_RE)) {
    const name = cleanFontName(m[1]);
    if (name && !name.includes("var(") && name.length > 2) fonts.add(name);
  }

  for (const m of text.matchAll(FONT_FACE_RE)) {
    const name = m[1].trim().replace(/['"]/g, "");
    if (name) { fonts.add(name); sources.add("local/@font-face"); }
  }

  for (const m of text.matchAll(GOOGLE_FONT_RE)) {
    const families = decodeURIComponent(m[1]).split("|");
    for (const fam of families) {
      const name = fam.split(":")[0].replace(/\+/g, " ").trim();
      if (name) { fonts.add(name); sources.add("Google Fonts"); }
    }
  }

  for (const m of text.matchAll(IMPORT_FONT_RE)) {
    const pkg = m[2].trim();
    const name = pkg.split("/").pop().replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    fonts.add(name);
    sources.add("@fontsource");
  }

  return { fonts: [...fonts], sources: [...sources] };
}

// ── CSS variable extraction ───────────────────────────────────────────────────

const CSS_VAR_DEF_RE = /--([\w-]+)\s*:\s*([^;}{]+)/g;

function extractCssVars(text) {
  // Only extract vars defined in :root or at top-level (not inside selectors)
  const vars = {};

  // Find :root blocks
  const rootBlocks = [];
  const rootRe = /(?::root|html)\s*\{([^}]+)\}/gi;
  for (const m of text.matchAll(rootRe)) rootBlocks.push(m[1]);

  // Also scan top-level (some projects define vars without :root)
  rootBlocks.push(text);

  for (const block of rootBlocks) {
    for (const m of block.matchAll(CSS_VAR_DEF_RE)) {
      const name  = "--" + m[1].trim();
      const value = m[2].trim();
      if (value && !value.includes("{")) {
        vars[name] = value;
      }
    }
  }

  return vars;
}

// ── Tailwind config extraction ────────────────────────────────────────────────

function extractTailwindTheme(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");

    const colors = {};
    const fonts  = {};

    // Extract colors from theme.colors / theme.extend.colors
    const colorBlockRe = /colors\s*:\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}/g;
    for (const m of text.matchAll(colorBlockRe)) {
      const block = m[1];
      for (const entry of block.matchAll(/['"]?([\w-]+)['"]?\s*:\s*['"]?(#[0-9a-fA-F]{3,6})['"]?/g)) {
        colors[entry[1]] = normalizeHex(entry[2]);
      }
    }

    // Extract fontFamily
    const fontBlockRe = /fontFamily\s*:\s*\{([^}]+)\}/g;
    for (const m of text.matchAll(fontBlockRe)) {
      const block = m[1];
      for (const entry of block.matchAll(/['"]?([\w-]+)['"]?\s*:\s*\[['"]([^'"]+)['"]/g)) {
        fonts[entry[1]] = entry[2];
      }
    }

    return { colors, fonts };
  } catch { return null; }
}

// ── Framework detection ───────────────────────────────────────────────────────

function detectFramework(files, allText) {
  const hasFile = (name) => files.some(f => path.basename(f) === name);
  const hasText = (s) => allText.includes(s);

  if (hasFile("tailwind.config.js") || hasFile("tailwind.config.ts") || hasFile("tailwind.config.mjs")) return "tailwind";
  if (hasText("styled-components") || hasText("createGlobalStyle")) return "styled-components";
  if (hasText("@emotion/react") || hasText("css`") && hasText("emotion")) return "emotion";
  if (hasText("createTheme") && hasText("@mui/material")) return "mui";
  if (hasText("ChakraProvider") || hasText("@chakra-ui")) return "chakra";
  if (hasText(".module.css") || hasText(".module.scss")) return "css-modules";
  if (files.some(f => STYLE_EXTENSIONS.has(path.extname(f)))) return "plain-css";
  return "unknown";
}

// ── Color palette builder ─────────────────────────────────────────────────────

function buildPalette(colorFreq, cssVars) {
  // Sort by frequency descending
  const sorted = Object.entries(colorFreq).sort((a, b) => b[1] - a[1]);

  // Top 12 most-used colors
  const topColors = sorted.slice(0, 12).map(([hex]) => hex);

  // Try to classify by role based on CSS var names
  const palette = {};
  const varColorMap = {};

  for (const [name, val] of Object.entries(cssVars)) {
    if (/^#[0-9a-fA-F]{3,6}$/.test(val)) {
      varColorMap[normalizeHex(val)] = name;
    }
  }

  // Classify colors
  for (const hex of topColors) {
    const varName = varColorMap[hex];
    if (varName) {
      // Use the var name to guess role
      const role = varName.replace(/^--/, "").replace(/-color$/, "");
      palette[role] = hex;
    }
  }

  // If palette is sparse, add raw top colors
  if (Object.keys(palette).length < 3) {
    topColors.slice(0, 6).forEach((hex, i) => {
      if (!Object.values(palette).includes(hex)) {
        palette[`color${i + 1}`] = hex;
      }
    });
  }

  // Detect dark/light mode
  const bgColors = Object.entries(palette)
    .filter(([k]) => /bg|background|surface|base/.test(k))
    .map(([, v]) => v);

  let mode = "unknown";
  if (bgColors.length) {
    const bg = parseInt(bgColors[0].slice(1), 16);
    const brightness = ((bg >> 16) & 0xff) * 0.299 + ((bg >> 8) & 0xff) * 0.587 + (bg & 0xff) * 0.114;
    mode = brightness < 128 ? "dark" : "light";
  }

  return { palette, mode, raw: topColors };
}

// ── Main scanner ──────────────────────────────────────────────────────────────

export function scanTheme(cwd = process.cwd()) {
  const allFiles = walkDir(cwd);
  const styleFiles = allFiles.filter(f => STYLE_EXTENSIONS.has(path.extname(f)));
  const jsFiles    = allFiles.filter(f => JS_EXTENSIONS.has(path.extname(f)));
  const htmlFiles  = allFiles.filter(f => [".html", ".htm"].includes(path.extname(f)));

  const tailwindConfig = allFiles.find(f =>
    /tailwind\.config\.(js|ts|mjs|cjs)$/.test(f)
  );

  // Read all style + HTML content
  const styleTexts = [...styleFiles, ...htmlFiles].map(f => {
    try { return fs.readFileSync(f, "utf8"); } catch { return ""; }
  });

  // Read JS files for CSS-in-JS patterns (but skip large ones)
  const jsTexts = jsFiles
    .filter(f => { try { return fs.statSync(f).size < 200_000; } catch { return false; } })
    .map(f => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } });

  const allStyleText = styleTexts.join("\n");
  const allJsText    = jsTexts.join("\n");
  const allText      = allStyleText + "\n" + allJsText;

  // Extract
  const colorFreq = extractColors(allStyleText);

  // Also get colors from JS (CSS-in-JS)
  const jsColorFreq = extractColors(allJsText);
  for (const [hex, count] of Object.entries(jsColorFreq)) {
    colorFreq[hex] = (colorFreq[hex] || 0) + Math.round(count * 0.5); // weight JS colors less
  }

  const cssVars = extractCssVars(allStyleText);

  const fontData = { fonts: new Set(), sources: new Set() };
  for (const text of [...styleTexts, ...jsTexts]) {
    const { fonts, sources } = extractFonts(text, "");
    fonts.forEach(f => fontData.fonts.add(f));
    sources.forEach(s => fontData.sources.add(s));
  }

  const framework = detectFramework(allFiles, allText);

  // Tailwind override
  let tailwindTheme = null;
  if (tailwindConfig) {
    tailwindTheme = extractTailwindTheme(tailwindConfig);
    if (tailwindTheme) {
      for (const [name, hex] of Object.entries(tailwindTheme.colors)) {
        colorFreq[hex] = (colorFreq[hex] || 0) + 5; // boost Tailwind colors
      }
      for (const [role, family] of Object.entries(tailwindTheme.fonts)) {
        fontData.fonts.add(family);
      }
    }
  }

  const { palette, mode, raw } = buildPalette(colorFreq, cssVars);

  // Classify fonts
  const fontList = [...fontData.fonts].filter(f =>
    !["inherit", "initial", "unset", "system-ui", "sans-serif", "serif", "monospace",
      "-apple-system", "BlinkMacSystemFont", "Segoe UI"].includes(f)
  );

  const monoKeywords = /mono|code|courier|consol|jetbrain|fira|hack|source code/i;
  const monoFont   = fontList.find(f => monoKeywords.test(f));
  const primaryFont = fontList.find(f => !monoKeywords.test(f));

  return {
    fonts: {
      primary:  primaryFont || null,
      mono:     monoFont    || null,
      all:      fontList,
      sources:  [...fontData.sources],
    },
    colors: {
      palette,
      mode,
      raw: raw.slice(0, 20),
    },
    cssVars,
    framework,
    tailwind: tailwindTheme,
    stats: {
      styleFiles: styleFiles.length,
      jsFiles:    jsFiles.length,
      colorsFound: Object.keys(colorFreq).length,
      varsFound:   Object.keys(cssVars).length,
    },
  };
}

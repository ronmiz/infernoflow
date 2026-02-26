// Zero-dependency color/output utilities using ANSI codes

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  orange: "\x1b[38;5;208m",
};

const noColor = !process.stdout.isTTY || process.env.NO_COLOR;

function paint(code, text) {
  if (noColor) return text;
  return `${code}${text}${c.reset}`;
}

export const bold    = t => paint(c.bold, t);
export const red     = t => paint(c.red, t);
export const green   = t => paint(c.green, t);
export const yellow  = t => paint(c.yellow, t);
export const cyan    = t => paint(c.cyan, t);
export const gray    = t => paint(c.gray, t);
export const white   = t => paint(c.white, t);
export const orange  = t => paint(c.orange, t);
export const boldRed    = t => paint(c.bold + c.red, t);
export const boldGreen  = t => paint(c.bold + c.green, t);
export const boldYellow = t => paint(c.bold + c.yellow, t);
export const boldOrange = t => paint(c.bold + c.orange, t);

function strip(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function header(text) {
  const title = boldOrange("🔥 infernoflow") + gray(" — " + text);
  console.log("\n" + title);
  console.log(gray("─".repeat(50)));
}

export function ok(msg)          { console.log("  " + green("✔") + " " + msg); }
export function fail(msg, hint)  {
  console.log("  " + red("✘") + " " + red(msg));
  if (hint) console.log("      " + gray("→ " + hint));
}
export function warn(msg)        { console.log("  " + yellow("⚠") + " " + yellow(msg)); }
export function info(msg)        { console.log("  " + cyan("ℹ") + " " + msg); }
export function section(title)   { console.log("\n" + bold(white(title))); }

export function done(msg) {
  console.log("\n" + boldGreen("✨ " + msg) + "\n");
}

export function nextSteps(steps) {
  console.log(bold("Next steps:"));
  steps.forEach((s, i) => {
    console.log("  " + gray((i + 1) + ".") + " " + s);
  });
  console.log();
}

export function errorAndExit(msg, hint) {
  console.error("\n" + boldRed("Error: ") + red(msg));
  if (hint) console.error(gray("  → " + hint));
  console.error();
  process.exit(1);
}

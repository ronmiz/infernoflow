let c = fs.readFileSync('lib/commands/context.mjs','utf8');

c = c.replace(
  'const copyFlag = hasFlag("--copy") || hasFlag("-c");',
  'const copyFlag   = hasFlag("--copy")   || hasFlag("-c");\n  const cursorFlag  = hasFlag("--cursor");\n  const copilotFlag = hasFlag("--copilot");'
);

const extra = [
  '  if (cursorFlag) {',
  '    fs.writeFileSync(".cursorrules", contextMd, "utf8");',
  '    console.log("  \\x1b[32m✔ Written to .cursorrules — Cursor loads this automatically\\x1b[0m");',
  '  }',
  '  if (copilotFlag) {',
  '    if (!fs.existsSync(".github")) fs.mkdirSync(".github");',
  '    fs.writeFileSync(".github/copilot-instructions.md", contextMd, "utf8");',
  '    console.log("  \\x1b[32m✔ Written to .github/copilot-instructions.md — Copilot loads this automatically\\x1b[0m");',
  '  }',
  '',
  '  // -- Print summary'
].join('\n');

c = c.replace('  // \u2500\u2500 Print summary', extra);
fs.writeFileSync('lib/commands/context.mjs', c, 'utf8');
console.log('done');

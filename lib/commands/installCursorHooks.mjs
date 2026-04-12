import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { header, ok, warn, done, nextSteps, cyan, yellow } from "../ui/output.mjs";
import { installCursorHooksArtifacts } from "../cursorHooksInstall.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getTemplatesRoot() {
  return path.resolve(__dirname, "../../templates");
}

export async function installCursorHooksCommand(args) {
  const cwd = process.cwd();
  const force = args.includes("--force") || args.includes("-f");

  header("install-cursor-hooks");

  installCursorHooksArtifacts({
    cwd,
    templatesRoot: getTemplatesRoot(),
    force,
    silent: false,
    logOk: (msg) => ok(msg),
    logWarn: (msg) => warn(msg),
  });

  done("Cursor draft hooks installed");

  nextSteps([
    "Restart Cursor (or reload window) so " + yellow(".cursor/hooks.json") + " is picked up",
    "Use Agent chat — each assistant reply appends to " + yellow("inferno/CONTEXT.draft.md") + " (gitignored)",
    cyan("npm run inferno:promote-draft") + " — preview draft",
    cyan("npm run inferno:promote-draft -- --append-notes") + " — merge into inferno/CONTEXT.md under Decisions",
    cyan("npm run inferno:promote-draft -- --clear") + " — discard draft",
  ]);
}

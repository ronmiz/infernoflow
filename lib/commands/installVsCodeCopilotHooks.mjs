import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { header, ok, warn, done, nextSteps, cyan, yellow } from "../ui/output.mjs";
import { installVsCodeCopilotHooksArtifacts } from "../vsCodeCopilotHooksInstall.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getTemplatesRoot() {
  return path.resolve(__dirname, "../../templates");
}

export async function installVsCodeCopilotHooksCommand(args) {
  const cwd = process.cwd();
  const force = args.includes("--force") || args.includes("-f");

  header("install-vscode-copilot-hooks");

  installVsCodeCopilotHooksArtifacts({
    cwd,
    templatesRoot: getTemplatesRoot(),
    force,
    silent: false,
    logOk: (msg) => ok(msg),
    logWarn: (msg) => warn(msg),
  });

  done("VS Code / Copilot draft hooks installed");

  nextSteps([
    "Requires VS Code + GitHub Copilot and **Agent hooks (Preview)** — see " +
      yellow("https://code.visualstudio.com/docs/copilot/customization/hooks"),
    "Hooks load from " + yellow(".github/hooks/*.json") + " — restart VS Code or reload window after first install",
    "Check the **GitHub Copilot Chat Hooks** output channel if nothing runs",
    cyan("npm run inferno:promote-draft") + " — preview draft",
    cyan("npm run inferno:promote-draft -- --append-notes") + " — merge into inferno/CONTEXT.md",
  ]);
}

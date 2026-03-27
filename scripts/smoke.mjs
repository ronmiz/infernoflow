import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = join(__dirname, "..", "bin", "infernoflow.mjs");

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });
}

const help = run(["--help"]);
if (help.status !== 0) throw new Error("help command failed");
if (!help.stdout.includes("suggest")) throw new Error("suggest command missing from help output");
if (!help.stdout.includes("implement")) throw new Error("implement command missing from help output");
if (!help.stdout.includes("--adopt")) throw new Error("init --adopt option missing from help output");
if (!help.stdout.includes("--report-human-only")) throw new Error("init --report-human-only option missing from help output");
if (!help.stdout.includes("--lang <name>")) throw new Error("init --lang option missing from help output");
if (!help.stdout.includes("--framework <name>")) throw new Error("init --framework option missing from help output");
if (!help.stdout.includes("--project-type <t>")) throw new Error("init --project-type option missing from help output");

const version = run(["--version"]);
if (version.status !== 0) throw new Error("version command failed");

const unknown = run(["unknown-command"]);
if (unknown.status === 0) throw new Error("unknown command must fail");
if (!unknown.stderr.includes("Unknown command")) throw new Error("unknown command message missing");

console.log("smoke checks passed");

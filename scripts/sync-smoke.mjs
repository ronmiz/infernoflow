import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bin = join(__dirname, "..", "bin", "infernoflow.mjs");

const missingAuto = spawnSync(process.execPath, [bin, "sync"], { encoding: "utf8" });
if (missingAuto.status === 0) throw new Error("sync without --auto should fail");

const out = spawnSync(process.execPath, [bin, "sync", "--auto", "--json"], {
  encoding: "utf8",
  cwd: join(__dirname, ".."),
});
if (out.status === 0) {
  const parsed = JSON.parse(out.stdout);
  if (!Object.prototype.hasOwnProperty.call(parsed, "didApply")) {
    throw new Error("sync --auto --json missing didApply");
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, "policyDecision")) {
    throw new Error("sync --auto --json missing policyDecision");
  }
} else {
  const parsed = JSON.parse(out.stdout || "{}");
  if (!Object.prototype.hasOwnProperty.call(parsed, "reasonCodes")) {
    throw new Error("sync --auto --json missing reasonCodes");
  }
}

console.log("sync smoke checks passed");


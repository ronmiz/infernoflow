/**
 * Personal (per-user, per-machine) infernoflow settings: ~/.infernoflow/config.json
 *
 * Settings that decide WHERE personal data goes must not come from a file
 * inside the repository — a pull request could otherwise redirect every
 * developer's personal memory (F8, 0.46.0). They live here instead.
 * INFERNOFLOW_HOME overrides the folder (used by tests).
 */
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

export function infernoflowHome() {
  return process.env.INFERNOFLOW_HOME || path.join(os.homedir(), ".infernoflow");
}

export function personalConfigPath() {
  return path.join(infernoflowHome(), "config.json");
}

export function readPersonalConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(personalConfigPath(), "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}

export function writePersonalConfig(cfg) {
  const p = personalConfigPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

/** Expand ~ and make absolute (relative paths resolve against the home folder, never the repo). */
export function expandUserPath(p) {
  let dir = String(p || "").trim();
  if (!dir) return dir;
  if (dir === "~" || dir.startsWith("~/") || dir.startsWith("~\\")) dir = path.join(os.homedir(), dir.slice(1).replace(/^[\/\\]/, ""));
  if (!path.isAbsolute(dir)) dir = path.resolve(os.homedir(), dir);
  return dir;
}

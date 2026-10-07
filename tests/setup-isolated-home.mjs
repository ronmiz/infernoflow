/**
 * Give every test run a throwaway home directory.
 *
 * Several tests spawn the real CLI, and `setup` / the upgrade backfill write
 * the MCP registration into ~/.claude.json and the Claude Desktop config.
 * Without this, `npm test` on a developer machine rewrote the developer's own
 * ~/.claude.json to point at a temp project that is deleted a second later —
 * silently breaking their Claude Code MCP setup.
 *
 * Child processes inherit process.env, so spawned CLIs see the same home.
 */
import * as fs   from "node:fs";
import * as os   from "node:os";
import * as path from "node:path";

if (!process.env.INFERNOFLOW_TEST_HOME) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "infernoflow-test-home-"));
  process.env.INFERNOFLOW_TEST_HOME = home;
  process.env.HOME        = home;   // os.homedir() on POSIX
  process.env.USERPROFILE = home;   // os.homedir() on Windows
  process.env.APPDATA     = path.join(home, "AppData", "Roaming");   // Claude Desktop config on Windows
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
}

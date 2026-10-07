/**
 * `infernoflow mcp` — run the MCP server from the INSTALLED PACKAGE (0.45.0).
 *
 * Before 0.45.0 every project got its own copy of the server
 * (.cursor/inferno-mcp-server.mjs) and the AI tools ran that copy. Copies were
 * never updated (fixes didn't reach users) and, being tracked in git, a change
 * pulled from a teammate's branch was code your AI tool would execute. MCP
 * configs written by `setup` now run `node <package>/bin/infernoflow.mjs mcp`,
 * so the server always matches the installed CLI.
 *
 * stdout is reserved for JSON-RPC: nothing else may be printed here.
 */
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function mcpCommand(_args) {
  // lib/commands → ../../templates (repo) or dist/lib/commands → dist/templates (shipped)
  const server = path.resolve(__dirname, "../../templates/cursor/inferno-mcp-server.mjs");
  await import(pathToFileURL(server).href);   // the server starts reading stdin on import
}

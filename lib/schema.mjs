/**
 * The ONE definition of infernoflow memory entry types (D9, 0.46.0).
 *
 * Before 0.46.0 the CLI accepted `preference` but the MCP `amp_write` enum did
 * not, the skill told agents to type dead ends as `gotcha` while the protocol
 * block said `attempt`, and help text still described the pre-0.43 `inferno/`
 * folder. Everything that lists types now reads them from here: CLI validation
 * and help, the MCP tool schemas, and the consistency test that checks the
 * shipped skill / agent / protocol text against this list.
 *
 * AMP-spec types are stored as-is. Other types are stored on the wire as
 * `note` + `meta.subtype` (see amp/io.mjs toAmp/fromAmp) and round-trip back.
 */
export const ENTRY_TYPES = [
  { name: "gotcha",     amp: true,  desc: "Something behaved contrary to a reasonable expectation and cost time." },
  { name: "decision",   amp: true,  desc: "A non-obvious choice — always include the *because*." },
  { name: "attempt",    amp: true,  desc: "A dead end: something tried that did NOT work (use result=failed)." },
  { name: "note",       amp: true,  desc: "General context worth keeping." },
  { name: "detection",  amp: true,  desc: "An automatically detected observation." },
  { name: "pattern",    amp: true,  desc: "A recurring pattern in this codebase." },
  { name: "preference", amp: false, desc: "A durable thing the user wants across sessions." },
];

/** Types an AI agent may write through MCP (`amp_write`) and filter on (`amp_read`). */
export const AGENT_TYPES = ENTRY_TYPES.map(t => t.name);

/** Extra legacy types the CLI still accepts for back-compat (never offered to agents). */
export const LEGACY_CLI_TYPES = ["theme", "handoff", "error"];

/** Everything `infernoflow log --type` accepts. */
export const CLI_TYPES = [...AGENT_TYPES, ...LEGACY_CLI_TYPES];

/** Valid `--result` values. */
export const RESULTS = ["worked", "failed", "partial", "unknown"];

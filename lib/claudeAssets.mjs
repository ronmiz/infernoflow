/**
 * Keep the infernoflow Claude Code assets in a project current:
 *   .claude/skills/infernoflow-memory/SKILL.md
 *   .claude/agents/memory-keeper.md
 *   .claude/hooks/infernoflow-agent-guard.mjs
 *
 * Runs opportunistically from the rule-file refresh path (every `log` /
 * `refresh` / MCP boot) and from `init`, so upgrades reach existing projects.
 *
 * D10 (0.46.0) update policy — "replace if unedited":
 *   - missing                      → installed
 *   - identical to the template    → nothing to do
 *   - identical to a template that an EARLIER release shipped (known hashes)
 *                                  → replaced silently (the user never edited it)
 *   - edited by the user           → left alone; the new template is written next
 *                                    to it as `<name>.new` and reported once
 *   - generated hooks              → always replaced (security-relevant code)
 * Only writes inside an initialized project. Never throws.
 */
import * as fs     from "node:fs";
import * as path   from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function templatesRoot() { return path.resolve(__dirname, "../templates"); }

/** sha256 of content with CRLF normalised. */
const hashOf = (t) => crypto.createHash("sha256").update(String(t).replace(/\r\n/g, "\n")).digest("hex");

/** Templates shipped by earlier releases (0.44.16 – 0.45.0). An exact match means "never edited". */
const KNOWN_PREVIOUS = new Set([
  "59ca1d6150462664c9677a112bc8cf57412b048788b8af3aef826acfe9a90fde", // SKILL.md 0.44.16–0.45.0
  "bb30ab374eace187685923ab2efb476703a9e0f13e0c99d6961104b04baa5953", // memory-keeper.md 0.44.16–0.45.0
]);

const ASSETS = [
  { src: ["skills", "infernoflow-memory", "SKILL.md"], dst: ["skills", "infernoflow-memory", "SKILL.md"], generated: false },
  { src: ["agents", "memory-keeper.md"],               dst: ["agents", "memory-keeper.md"],               generated: false },
  { src: ["hooks", "infernoflow-agent-guard.mjs"],     dst: ["hooks", "infernoflow-agent-guard.mjs"],     generated: true  },
];

const _ensured = new Set();

function hasMemoryStore(cwd) {
  return fs.existsSync(path.join(cwd, ".ai-memory")) || fs.existsSync(path.join(cwd, "inferno"));
}

/**
 * @param {string} cwd project root
 * @returns {{ created: string[], updated: string[], pending: string[] }} relative paths
 */
export function syncClaudeAssets(cwd) {
  const res = { created: [], updated: [], pending: [] };
  if (!cwd || !hasMemoryStore(cwd)) return res;
  const tmpl = templatesRoot();
  for (const a of ASSETS) {
    const src = path.join(tmpl, ...a.src);
    const dst = path.join(cwd, ".claude", ...a.dst);
    const rel = [".claude", ...a.dst].join("/");
    let want;
    try { want = fs.readFileSync(src, "utf8"); } catch { continue; }
    let have = null;
    try { have = fs.readFileSync(dst, "utf8"); } catch { /* missing */ }
    try {
      if (have == null) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.writeFileSync(dst, want, "utf8");
        res.created.push(rel);
      } else if (hashOf(have) === hashOf(want)) {
        // current
      } else if (a.generated || KNOWN_PREVIOUS.has(hashOf(have))) {
        fs.writeFileSync(dst, want, "utf8");
        res.updated.push(rel);
      } else {
        const side = dst + ".new";
        let sideHave = null;
        try { sideHave = fs.readFileSync(side, "utf8"); } catch { /* none */ }
        if (sideHave == null || hashOf(sideHave) !== hashOf(want)) {
          fs.writeFileSync(side, want, "utf8");
          res.pending.push(rel);
        }
      }
    } catch { /* read-only checkout etc. */ }
  }
  return res;
}

/** Back-compat entry point: returns how many files were created or updated. */
export function ensureClaudeAssets(cwd) {
  try {
    if (!cwd || _ensured.has(cwd)) return 0;
    _ensured.add(cwd);
    const r = syncClaudeAssets(cwd);
    if (r.pending.length) {
      process.stderr.write(`  infernoflow: a newer version of ${r.pending.join(", ")} is available — you edited yours, so it was saved as <name>.new; merge when convenient.\n`);
    }
    return r.created.length + r.updated.length;
  } catch { return 0; }
}

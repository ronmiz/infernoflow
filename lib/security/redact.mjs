/**
 * Secret redaction for everything infernoflow writes to memory (0.45.0).
 *
 * Memory files are plain text and are committed with the repository, so a
 * token that reaches an entry is effectively published. Every write path goes
 * through amp/io.mjs → appendEntry(), which calls redactSecrets() on the
 * message, tags, result and detail body; transcript snapshots are redacted too.
 *
 * Policy: REPLACE, never reject. The matched secret becomes
 * `[REDACTED:<kind>]` and the rest of the entry is kept, so a prompt hook
 * never silently loses the signal.
 *
 * Patterns are specific (known token prefixes / structures). The generic
 * key=value rules only fire for credential-looking key names AND a value that
 * looks like a secret (has a digit, or is long), so prose such as
 * "token: refreshed" or "secret=process.env.X" is left alone.
 * Every quantifier is bounded or anchored so long inputs stay linear-time.
 */

const KEY_NAMES = "(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|bearer[_-]?token|token|passwd|password|pwd|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key|[A-Z][A-Z0-9_]{0,40}_(?:SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY))";
// A value counts as a secret if it has a letter AND a digit, or is 24+ chars of token alphabet.
const SECRETISH = "(?=[^\\s\"',;]{0,200}[0-9])(?=[^\\s\"',;]{0,200}[A-Za-z])[^\\s\"',;]{8,200}|[A-Za-z0-9_\\-+/=]{24,400}";

/** @type {Array<[string, RegExp]>} kind → pattern (all global) */
const PATTERNS = [
  ["private-key",      /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]{0,20000}?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|$)/g],
  ["anthropic-key",    /\bsk-ant-[A-Za-z0-9_-]{16,300}/g],
  ["openrouter-key",   /\bsk-or-[A-Za-z0-9_-]{16,300}/g],
  ["openai-key",       /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,300}/g],
  ["github-token",     /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{40,255})/g],
  ["npm-token",        /\bnpm_[A-Za-z0-9]{30,255}/g],
  ["aws-access-key",   /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["google-api-key",   /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["slack-token",      /\bxox[abposr]-[A-Za-z0-9-]{10,255}/g],
  ["stripe-key",       /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,255}/g],
  ["jwt",              /\beyJ[A-Za-z0-9_-]{8,4000}\.eyJ[A-Za-z0-9_-]{8,4000}\.[A-Za-z0-9_-]{8,4000}/g],
  ["bearer-token",     /\b(Bearer\s{1,5})(?!\[REDACTED)[A-Za-z0-9._~+/=-]{16,4000}/g],
  // scheme://user:pass@ — scheme bounded and not preceded by scheme chars (linear time).
  ["url-credentials",  /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\/\/)[^\s:/@]{1,200}:[^\s@/]{3,200}(?=@)/gi],
  ["connection-string",/\b((?:Password|Pwd|AccountKey|SharedAccessKey)\s{0,5}=\s{0,5})(?!\[REDACTED)[^;\s"']{4,500}/gi],
  // key: value / key=value / "key": "value" (JSON, YAML, .env, CLI flags)
  ["credential",       new RegExp(`(["']?\\b${KEY_NAMES}["']?\\s{0,5}[=:]\\s{0,5}["']?)(?!\\[REDACTED)(?:${SECRETISH})`, "gi")],
];

/**
 * @param {string} text
 * @returns {{ text: string, kinds: string[] }} redacted text + kinds found (deduped)
 */
export function redactSecrets(text) {
  if (typeof text !== "string" || !text) return { text, kinds: [] };
  const kinds = new Set();
  let out = text;
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, (match, prefix) => {
      kinds.add(kind);
      // Patterns with a captured prefix keep it (e.g. "password=" or "https://").
      return (typeof prefix === "string" && match.startsWith(prefix) ? prefix : "") + `[REDACTED:${kind}]`;
    });
  }
  return { text: out, kinds: [...kinds] };
}

/** True if the text contains anything redactSecrets would replace. */
export function containsSecret(text) {
  return redactSecrets(text).kinds.length > 0;
}

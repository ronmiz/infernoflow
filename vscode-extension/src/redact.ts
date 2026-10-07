/**
 * Secret redaction for memory written from the extension (CLI 0.46.0 parity).
 * KEEP IN SYNC with lib/security/redact.mjs in the CLI package — same patterns,
 * same "[REDACTED:<kind>]" output. Memory files are committed with the repo,
 * so known token formats must never reach them.
 */
const KEY_NAMES = "(?:api[_-]?key|apikey|secret[_-]?key|client[_-]?secret|secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|bearer[_-]?token|token|passwd|password|pwd|private[_-]?key|aws[_-]?secret[_-]?access[_-]?key|[A-Z][A-Z0-9_]{0,40}_(?:SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY))";
const SECRETISH = "(?=[^\\s\"',;]{0,200}[0-9])(?=[^\\s\"',;]{0,200}[A-Za-z])[^\\s\"',;]{8,200}|[A-Za-z0-9_\\-+/=]{24,400}";

const PATTERNS: Array<[string, RegExp]> = [
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
  ["url-credentials",  /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\/\/)[^\s:/@]{1,200}:[^\s@/]{3,200}(?=@)/gi],
  ["connection-string",/\b((?:Password|Pwd|AccountKey|SharedAccessKey)\s{0,5}=\s{0,5})(?!\[REDACTED)[^;\s"']{4,500}/gi],
  ["credential",       new RegExp(`(["']?\\b${KEY_NAMES}["']?\\s{0,5}[=:]\\s{0,5}["']?)(?!\\[REDACTED)(?:${SECRETISH})`, "gi")],
];

export function redactSecrets(text: string): string {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, (match: string, prefix?: unknown) =>
      (typeof prefix === "string" && match.startsWith(prefix) ? prefix : "") + `[REDACTED:${kind}]`);
  }
  return out;
}

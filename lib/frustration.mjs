/**
 * Deterministic prompt signals for the capture hooks (0.46.3).
 *
 * Single source of truth: the Claude Code UserPromptSubmit hook embeds these
 * functions verbatim (Function#toString in lib/commands/setup.mjs), and the
 * Cursor beforeSubmitPrompt hook (templates/cursor/hooks/inferno-session-draft.mjs)
 * carries an identical copy — tests/frustration.test.mjs keeps them in sync.
 *
 * Plain functions, no imports, no closures: they must work when pasted into a
 * standalone hook file.
 */

/**
 * The part of a prompt the human actually typed, or "" when the prompt is
 * machine text. Subagent hand-backs, system reminders, task notifications and
 * slash-command / hook output reach UserPromptSubmit the same way a typed
 * prompt does, and pasted logs, code and quotes often contain words like
 * "not working" without the user being frustrated.
 * @param {unknown} prompt
 * @returns {string}
 */
export function humanText(prompt) {
  if (typeof prompt !== "string") return "";
  if (/^\s*<(agent-message|system-reminder|task-notification|command-|local-command|user-prompt-submit-hook|bash-|tool-|function_)/i.test(prompt)) return "";
  if (/^\s*\[(?:Subagent hand-back|Request interrupted)/i.test(prompt)) return "";
  if (/^\s*Caveat: The messages below were generated/i.test(prompt)) return "";
  // Bound the work: this runs on every prompt. A huge paste keeps its start
  // and end, where a person's own words usually are.
  let p = prompt.length > 20000 ? prompt.slice(0, 10000) + "\n" + prompt.slice(-10000) : prompt;
  // Line-anchored patterns use [ \t]*, never \s* — with the m flag \s* also
  // eats newlines and backtracks badly over blank lines.
  p = p
    .replace(/<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")     // <tag>…</tag> blocks
    .replace(/```[\s\S]*?(?:```|$)/g, " ")                            // fenced code (closed or not)
    .replace(/^(?: {4}|\t).*$/gm, " ")                                // indented code
    .replace(/^[ \t]*>.*$/gm, " ")                                    // quoted lines
    .replace(/^[ \t]*(?:at [\w.$<>\[\]]+ \(.*\)|at \S+:\d+|(?:[A-Z]\w*)?(?:Error|Exception)\b[^\n]*:|Traceback \(|File "[^"\n]*", line \d).*$/gm, " ") // stack traces
    .replace(/\s+/g, " ")
    .trim();
  // What a person types is short; keep both ends of anything longer.
  return p.length > 500 ? p.slice(0, 250) + " … " + p.slice(-250) : p;
}

/**
 * True if the human text shows the user is stuck. Word-bounded phrases only;
 * the noisier signals ("!!", "retry") count only in a short prompt, where they
 * can't come from pasted output.
 * @param {string} text  output of humanText()
 * @returns {boolean}
 */
export function isFrustration(text) {
  if (typeof text !== "string" || !text) return false;
  const PHRASES = [
    /\bnot working\b/i,
    /\bstill (?:broken|failing|fails|crashing|crashes|the same|nothing|doesn['’]?t work)\b/i,
    /\bstill not (?:working|fixed|compiling|building|loading|passing|running|showing)\b/i,
    /\bdoes(?:n['’]?t| not) work\b/i,
    /\b(?:it|this|that|is|are|it['’]?s)\s+(?:still\s+|totally\s+|completely\s+)?broken\b/i,
    /\bbroken again\b/i,
    /\bsame (?:error|issue|problem)\b/i,
    /\bno change\b/i,
  ];
  if (PHRASES.some((re) => re.test(text))) return true;
  // Noisy signals only in a short prompt: "!!" ending a word ("fix it!!",
  // "why!!", "!!") but not code like "!!value"; "retry".
  const short = text.length <= 200;
  return short && (/!{2,}(?=\s|$)/.test(text) || /\bretry(?:ing)?\b/i.test(text));
}

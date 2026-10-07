/**
 * lmTools — register infernoflow as VS Code Language Model Tools.
 *
 * Why this exists:
 *   GitHub Copilot Chat (and any VS Code chat participant on the Language
 *   Model API) does NOT speak MCP — it can only see tools registered via
 *   `vscode.lm.registerTool()`. Until now, the rule-file Memory protocol
 *   block told the AI to "call `amp_write`"… but in Copilot, `amp_write`
 *   was never in the tool list, so the AI silently no-op'd the protocol.
 *   In Cursor / Claude Code the same tools are wired via MCP.
 *
 *   This file is the Copilot path: the extension itself becomes the tool
 *   provider. No MCP server, no ToolSearch, no Node required — just a
 *   direct in-process call to `ampIO.write()` / `ampIO.readEntries()`.
 *
 * Auto-discoverability:
 *   `package.json#contributes.languageModelTools[]` declares the tools so
 *   Copilot Chat shows them in its tool list. `canBeReferencedInPrompt: true`
 *   also lets the user `#amp_write` them by hand.
 *
 * Failure model:
 *   `vscode.lm.registerTool` was stabilized in VS Code 1.95. We capability-
 *   guard so older VS Code installs still load the extension — the LM tools
 *   just don't appear there. The sidebar / MCP path / CLI all still work.
 */

import * as vscode from "vscode";
import { ampIO } from "./amp";
import { DATA_NOT_INSTRUCTIONS, visible } from "./store";
import type { EntryType } from "infernoflow-amp";

// ── amp_write ────────────────────────────────────────────────────────────────

interface AmpWriteInput {
  type: EntryType;
  msg: string;
  file?: string;
  line?: number;
  tags?: string[];
}

const VALID_TYPES = new Set<EntryType>([
  "gotcha", "decision", "attempt", "note", "detection", "pattern",
]);

class AmpWriteTool implements vscode.LanguageModelTool<AmpWriteInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AmpWriteInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { type, msg, file, line, tags } = options.input;

    if (!type || !VALID_TYPES.has(type)) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Invalid 'type'. Use one of: gotcha, decision, attempt, note, detection, pattern.`,
        ),
      ]);
    }
    if (typeof msg === "string" && msg.length > 1000) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`'msg' is too long (max 1000 characters) — keep entries to one sentence. Entry not written.`),
      ]);
    }
    if (tags && (!Array.isArray(tags) || tags.length > 10 || tags.some(t => typeof t !== "string" || t.length > 50))) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`'tags' must be up to 10 short strings. Entry not written.`),
      ]);
    }
    if (!msg || typeof msg !== "string" || !msg.trim()) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Missing 'msg' — entry not written.`),
      ]);
    }
    if (!ampIO.isInitialised()) {
      // Writing to ampIO will lazily create .ai-memory/, so this is informational
      // only — proceed anyway.
    }

    const entry = ampIO.write({
      type,
      // One line, exactly as shown in the confirmation.
      msg: msg.replace(/\s+/g, " ").trim(),
      file,
      line,
      tags,
      source: "copilot-lm-tool",
    });

    if (!entry) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Write failed. Check that the workspace is writable.`),
      ]);
    }
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `Logged ${entry.type}: "${entry.msg.slice(0, 80)}${entry.msg.length > 80 ? "…" : ""}"`,
      ),
    ]);
  }

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<AmpWriteInput>,
    _token: vscode.CancellationToken,
  ): vscode.PreparedToolInvocation {
    // Writes ask first (CLI 0.46.1 parity: only read-only tools are pre-approved).
    // Memory is shared with the team through git, so a person confirms what goes in.
    const type = options.input?.type || "entry";
    // The whole text and the tags are shown — exactly what will be written.
    const msg  = String(options.input?.msg || "").replace(/\s+/g, " ").slice(0, 1000);
    const tags = Array.isArray(options.input?.tags) && options.input.tags.length ? `\n\nTags: ${options.input.tags.map(t => String(t)).join(", ")}` : "";
    const esc  = (t: string) => t.replace(/[\\`*_{}[\]()#+!|<>]/g, c => "\\" + c);
    const file = options.input?.file ? ` (${esc(String(options.input.file).slice(0, 200))})` : "";
    return {
      invocationMessage: `Logging ${type} to infernoflow memory`,
      confirmationMessages: {
        title: "Save to project memory?",
        message: new vscode.MarkdownString(`**${esc(String(type))}**${file}: ${esc(msg)}${esc(tags)}\n\nProject memory is shared with your team through git.`),
      },
    };
  }
}

// ── amp_read ─────────────────────────────────────────────────────────────────

interface AmpReadInput {
  limit?: number;
  type?: EntryType;
  file?: string;
}

class AmpReadTool implements vscode.LanguageModelTool<AmpReadInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<AmpReadInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { limit = 10, type, file } = options.input || {};

    // Resolved entries and old commit notes are not shown to the AI (CLI parity).
    let entries = visible(ampIO.readEntries());
    if (type) entries = entries.filter(e => e.type === type);
    if (file) {
      const norm = (s: string) => s.replace(/\\/g, "/");
      const target = norm(file);
      entries = entries.filter(e => {
        if (!e.file) return false;
        const f = norm(e.file);
        return f === target || f.endsWith("/" + target) || target.endsWith("/" + f);
      });
    }

    // Newest first, capped
    entries = entries.sort((a, b) => b.ts - a.ts).slice(0, Math.max(1, Math.min(50, limit)));

    if (entries.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`No matching entries in infernoflow memory.`),
      ]);
    }

    const lines = entries.map(e => {
      const where = e.file ? ` (${e.file}${e.line ? ":" + e.line : ""})` : "";
      return `- 🔥 ${e.type}${where}: ${e.msg}`;
    });
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `${DATA_NOT_INSTRUCTIONS}\n\n${entries.length} entries from infernoflow memory:\n${lines.join("\n")}`,
      ),
    ]);
  }

  prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<AmpReadInput>,
    _token: vscode.CancellationToken,
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: `Reading infernoflow memory` };
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

/**
 * Register infernoflow's LM tools so Copilot Chat (and any other vscode.lm
 * consumer) can call them directly. Capability-guarded: silently no-ops on
 * VS Code < 1.95 where `vscode.lm.registerTool` doesn't exist.
 */
export function registerLmTools(context: vscode.ExtensionContext): void {
  // `vscode.lm.registerTool` was stabilized in 1.95. Guard defensively.
  if (typeof vscode.lm?.registerTool !== "function") return;

  try {
    context.subscriptions.push(
      vscode.lm.registerTool("amp_write", new AmpWriteTool()),
      vscode.lm.registerTool("amp_read",  new AmpReadTool()),
    );
  } catch {
    // Never fail activation just because LM tool registration broke.
  }
}

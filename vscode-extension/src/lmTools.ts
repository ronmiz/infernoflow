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
      msg: msg.trim(),
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
    return {
      invocationMessage: `Logging ${options.input?.type || "entry"} to infernoflow memory`,
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

    let entries = ampIO.readEntries();
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
        `${entries.length} entries from infernoflow memory:\n${lines.join("\n")}`,
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

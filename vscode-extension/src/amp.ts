/**
 * AMP I/O wrapper — single source of truth for memory inside the extension.
 *
 * Wraps `infernoflow-amp` (npm) so every surface (sidebar, status bar,
 * diagnostics, command handlers) reads through the same instance. Falls back
 * to legacy `inferno/sessions.jsonl` if `.ai-memory/` doesn't exist yet.
 *
 * Emits a `change` event whenever the on-disk file changes — file-watcher
 * picks up CLI writes, git pulls, manual edits, etc.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { AMP, AMPEntry, EntryType, HealthScore } from "infernoflow-amp";

// ── Public types ─────────────────────────────────────────────────────────────

export type ChangeListener = () => void;

export interface MemorySummary {
  total: number;
  gotchas: number;
  decisions: number;
  attempts: number;
  notes: number;
  detections: number;
  patterns: number;
  health: HealthScore;
  lastEntryTs?: number;
}

// ── Workspace resolution ─────────────────────────────────────────────────────

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function ampSessionsPath(root: string): string | undefined {
  const ampPath    = path.join(root, ".ai-memory", "sessions.jsonl");
  const legacyPath = path.join(root, "inferno", "sessions.jsonl");
  if (fs.existsSync(ampPath))    return ampPath;
  if (fs.existsSync(legacyPath)) return legacyPath;
  return undefined; // not initialised
}

// ── Singleton wrapper ────────────────────────────────────────────────────────

class AmpIO {
  private amp: AMP | undefined;
  private root: string | undefined;
  private listeners = new Set<ChangeListener>();
  private watcher: vscode.FileSystemWatcher | undefined;

  /** Bind to the current workspace. Re-call when the workspace changes. */
  attach(): void {
    this.detach();
    const root = workspaceRoot();
    if (!root) return;
    this.root = root;
    this.amp = new AMP(root);

    // Watch BOTH layouts so we catch CLI writes regardless of where they land.
    const pattern = new vscode.RelativePattern(root, "{.ai-memory,inferno}/sessions.jsonl");
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const fire = () => this.listeners.forEach(l => { try { l(); } catch { /* ignore */ } });
    this.watcher.onDidChange(fire);
    this.watcher.onDidCreate(fire);
    this.watcher.onDidDelete(fire);
  }

  detach(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
    this.amp = undefined;
    this.root = undefined;
  }

  isAttached(): boolean { return !!this.amp; }

  /** Returns the absolute path to the active sessions.jsonl (or undefined). */
  sessionsPath(): string | undefined {
    return this.root ? ampSessionsPath(this.root) : undefined;
  }

  /** True iff the project has been initialised (.ai-memory/ or inferno/). */
  isInitialised(): boolean {
    return !!this.sessionsPath();
  }

  /** Read all entries normalised to AMP shape. Returns [] if not initialised. */
  readEntries(): AMPEntry[] {
    if (!this.amp) return [];
    try { return this.amp.readAll(); } catch { return []; }
  }

  /** Append a new entry. AMP fills in id/ts/etc. */
  write(entry: { type: EntryType; msg: string; file?: string; line?: number; tags?: string[]; source?: string }): AMPEntry | undefined {
    if (!this.amp || !this.root) return undefined;
    try {
      return this.amp.write({ ...entry, source: entry.source || "vscode-extension" });
    } catch (err: unknown) {
      const m = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`infernoflow: failed to write entry — ${m}`);
      return undefined;
    }
  }

  /** Aggregate counts + health score for the status bar / sidebar header. */
  summary(): MemorySummary {
    const entries = this.readEntries();
    const count = (t: EntryType) => entries.filter(e => e.type === t).length;
    const lastEntry = entries[entries.length - 1];
    return {
      total:      entries.length,
      gotchas:    count("gotcha"),
      decisions:  count("decision"),
      attempts:   count("attempt"),
      notes:      count("note"),
      detections: count("detection"),
      patterns:   count("pattern"),
      health:     this.amp ? this.amp.health() : { score: 0, grade: "F" },
      lastEntryTs: lastEntry?.ts,
    };
  }

  /** Filter entries relevant to a specific file path (relative or absolute). */
  forFile(filePath: string): AMPEntry[] {
    if (!this.amp || !this.root) return [];
    const rel = path.isAbsolute(filePath)
      ? path.relative(this.root, filePath).replace(/\\/g, "/")
      : filePath.replace(/\\/g, "/");
    return this.readEntries().filter(e => {
      if (!e.file) return false;
      const f = e.file.replace(/\\/g, "/");
      return f === rel || f.endsWith("/" + rel) || rel.endsWith("/" + f);
    });
  }

  /** Subscribe to disk-change events. Returns an unsubscribe function. */
  onChange(listener: ChangeListener): vscode.Disposable {
    this.listeners.add(listener);
    return new vscode.Disposable(() => this.listeners.delete(listener));
  }

  /** Run the legacy → AMP migration via the underlying lib (when needed). */
  migrate(): { migrated: number; reason: string } {
    if (!this.root) return { migrated: 0, reason: "no workspace" };
    // The infernoflow-amp lib doesn't ship a migrate() yet; do it inline so
    // the extension can offer a one-click fix without shelling out.
    const legacy = path.join(this.root, "inferno", "sessions.jsonl");
    const ampDir = path.join(this.root, ".ai-memory");
    const ampSess = path.join(ampDir, "sessions.jsonl");
    if (!fs.existsSync(legacy)) return { migrated: 0, reason: "no legacy sessions.jsonl" };
    if (fs.existsSync(ampSess)) return { migrated: 0, reason: ".ai-memory/sessions.jsonl already exists" };
    if (!fs.existsSync(ampDir)) fs.mkdirSync(ampDir, { recursive: true });
    const amp = new AMP(this.root);
    const lines = fs.readFileSync(legacy, "utf8").split("\n").filter(Boolean);
    let count = 0;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        // Translate legacy infernoflow shape → AMP shape via the lib's write
        amp.write({
          type: (parsed.type as EntryType) || "note",
          msg:  parsed.summary || parsed.msg || "",
          file: parsed.file,
          line: parsed.line,
          tags: parsed.tags,
          source: parsed.source || "migrate",
          ts: typeof parsed.ts === "number" ? parsed.ts : (parsed.ts ? Date.parse(parsed.ts) : Date.now()),
          meta: {
            ...(parsed.result ? { result: parsed.result } : {}),
            ...(parsed.agent  ? { agent:  parsed.agent  } : {}),
          },
        });
        count++;
      } catch { /* skip unparseable */ }
    }
    return { migrated: count, reason: "ok" };
  }
}

export const ampIO = new AmpIO();

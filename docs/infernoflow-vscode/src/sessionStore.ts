import * as fs from 'fs';
import * as path from 'path';

export interface SessionEntry {
  type: 'gotcha' | 'decision' | 'attempt' | 'note';
  msg: string;
  ts: number;
  file?: string;
  line?: number;
  functionName?: string;
  source?: string;
}

export class SessionStore {
  private filePath: string;
  private infernoDir: string;

  constructor(private workspaceRoot: string) {
    this.infernoDir = path.join(workspaceRoot, 'inferno');
    this.filePath = path.join(this.infernoDir, 'sessions.jsonl');
  }

  /**
   * Read all session entries from sessions.jsonl
   */
  getAll(): SessionEntry[] {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line) as SessionEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is SessionEntry => entry !== null);
    } catch {
      return [];
    }
  }

  /**
   * Get entries filtered by type
   */
  getByType(type: SessionEntry['type']): SessionEntry[] {
    return this.getAll().filter(e => e.type === type);
  }

  /**
   * Get entries that reference a specific file
   */
  getForFile(relativePath: string): SessionEntry[] {
    const normalized = relativePath.replace(/\\/g, '/');
    return this.getAll().filter(e => {
      if (!e.file) { return false; }
      return e.file.replace(/\\/g, '/').includes(normalized) ||
             normalized.includes(e.file.replace(/\\/g, '/'));
    });
  }

  /**
   * Append a new entry to sessions.jsonl
   */
  append(entry: SessionEntry): void {
    // Ensure inferno/ directory exists
    if (!fs.existsSync(this.infernoDir)) {
      fs.mkdirSync(this.infernoDir, { recursive: true });
    }

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(this.filePath, line, 'utf8');
  }

  /**
   * Log a new entry with current timestamp
   */
  log(type: SessionEntry['type'], msg: string, file?: string, line?: number): void {
    this.append({
      type,
      msg,
      ts: Date.now(),
      file,
      line,
      source: 'vscode-extension',
    });
  }

  /**
   * Search entries by keyword
   */
  search(query: string): SessionEntry[] {
    const lower = query.toLowerCase();
    return this.getAll().filter(e =>
      e.msg.toLowerCase().includes(lower) ||
      e.type.includes(lower) ||
      (e.file && e.file.toLowerCase().includes(lower))
    );
  }

  /**
   * Calculate session health score (0-100)
   */
  getHealthScore(): { score: number; grade: string } {
    const entries = this.getAll();
    const gotchas = entries.filter(e => e.type === 'gotcha').length;
    const decisions = entries.filter(e => e.type === 'decision').length;
    const attempts = entries.filter(e => e.type === 'attempt').length;
    const notes = entries.filter(e => e.type === 'note').length;

    // Scoring: gotchas are most valuable
    let score = 0;
    score += Math.min(gotchas * 20, 40);    // up to 40 points for gotchas
    score += Math.min(decisions * 15, 30);   // up to 30 points for decisions
    score += Math.min(attempts * 15, 20);    // up to 20 points for attempts
    score += Math.min(notes * 5, 10);        // up to 10 points for notes
    score = Math.min(score, 100);

    let grade = 'F';
    if (score >= 80) { grade = 'A'; }
    else if (score >= 60) { grade = 'B'; }
    else if (score >= 40) { grade = 'C'; }
    else if (score >= 20) { grade = 'D'; }

    return { score, grade };
  }

  /**
   * Generate a handoff/switch summary — optimized for pasting into AI agents
   */
  generateHandoff(): string {
    const entries = this.getAll();
    const gotchas = entries.filter(e => e.type === 'gotcha');
    const decisions = entries.filter(e => e.type === 'decision');
    const attempts = entries.filter(e => e.type === 'attempt');
    const notes = entries.filter(e => e.type === 'note');
    const { score, grade } = this.getHealthScore();

    let output = `# 🔥 infernoflow — Agent Handoff\n\n`;
    output += `> **Session Health:** ${grade} (${score}/100) · ${entries.length} entries logged\n\n`;
    output += `---\n\n`;

    if (gotchas.length) {
      output += `## ⚠️ GOTCHAS — Read These First\n\n`;
      output += `> These are known landmines. Do NOT ignore them.\n\n`;
      gotchas.forEach((g, i) => {
        output += `**${i + 1}.** ${g.msg}`;
        if (g.file) { output += `\n   📁 \`${g.file}\`${g.line ? `:${g.line}` : ''}`; }
        output += '\n\n';
      });
    }

    if (attempts.length) {
      output += `## ❌ FAILED ATTEMPTS — Do NOT Repeat\n\n`;
      output += `> These approaches were tried and failed. Use different strategies.\n\n`;
      attempts.forEach((a, i) => {
        output += `~~${i + 1}. ${a.msg}~~`;
        if (a.file) { output += ` (\`${a.file}\`)`; }
        output += '\n\n';
      });
    }

    if (decisions.length) {
      output += `## ✓ DECISIONS — Follow These\n\n`;
      output += `> Architectural and design decisions already made. Don't revisit.\n\n`;
      decisions.forEach((d, i) => {
        output += `**${i + 1}.** ${d.msg}\n`;
      });
      output += '\n';
    }

    if (notes.length) {
      output += `## 📝 Context Notes\n\n`;
      const recentNotes = notes.slice(-5);
      recentNotes.forEach(n => {
        output += `- ${n.msg}\n`;
      });
      output += '\n';
    }

    // Summary for quick scanning
    output += `---\n\n`;
    output += `**Quick Stats:** ⚠️ ${gotchas.length} gotchas · ❌ ${attempts.length} failed · ✓ ${decisions.length} decisions · 📝 ${notes.length} notes\n`;

    return output;
  }

  /**
   * Generate a recap summary
   */
  generateRecap(): string {
    const entries = this.getAll();
    const { score, grade } = this.getHealthScore();
    const gotchas = entries.filter(e => e.type === 'gotcha').length;
    const decisions = entries.filter(e => e.type === 'decision').length;
    const attempts = entries.filter(e => e.type === 'attempt').length;
    const notes = entries.filter(e => e.type === 'note').length;

    let output = `## 🔥 infernoflow — Session Recap\n\n`;
    output += `**Health:** ${grade} (${score}/100)\n\n`;
    output += `| Type | Count |\n|---|---|\n`;
    output += `| ⚠️ Gotchas | ${gotchas} |\n`;
    output += `| ✓ Decisions | ${decisions} |\n`;
    output += `| ❌ Failed Attempts | ${attempts} |\n`;
    output += `| 📝 Notes | ${notes} |\n\n`;

    if (gotchas === 0) {
      output += `💡 **Tip:** Log gotchas — they're the most valuable entries.\n`;
      output += `They prevent the next AI session from repeating your mistakes.\n`;
    }
    if (attempts === 0) {
      output += `💡 **Tip:** Log failed attempts — "I tried X and it didn't work because Y"\n`;
    }

    return output;
  }

  /**
   * Check if sessions.jsonl exists
   */
  exists(): boolean {
    return fs.existsSync(this.filePath);
  }
}

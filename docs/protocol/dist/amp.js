"use strict";
/**
 * AI Memory Protocol (AMP) — Reference Implementation
 *
 * A zero-dependency TypeScript library for reading, writing, and generating
 * handoffs from AMP session files.
 *
 * Usage:
 *   import { AMP } from './amp';
 *   const amp = new AMP('/path/to/project');
 *   amp.write({ type: 'gotcha', msg: 'Auth header required' });
 *   const handoff = amp.handoff();
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AMP = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ─── ULID Generator (minimal, no dependencies) ───────────────────────────────
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function generateULID() {
    const now = Date.now();
    let timeStr = '';
    let t = now;
    for (let i = 0; i < 10; i++) {
        timeStr = ENCODING[t % 32] + timeStr;
        t = Math.floor(t / 32);
    }
    let randStr = '';
    for (let i = 0; i < 16; i++) {
        randStr += ENCODING[Math.floor(Math.random() * 32)];
    }
    return timeStr + randStr;
}
// ─── Core Library ─────────────────────────────────────────────────────────────
class AMP {
    constructor(workspaceRoot) {
        this.dir = path.join(workspaceRoot, '.ai-memory');
        this.sessionsPath = path.join(this.dir, 'sessions.jsonl');
        this.configPath = path.join(this.dir, 'amp.json');
    }
    // ─── Init ───────────────────────────────────────────────────────────────────
    /**
     * Initialize AMP in the workspace. Creates .ai-memory/ directory and files.
     */
    init(config) {
        if (!fs.existsSync(this.dir)) {
            fs.mkdirSync(this.dir, { recursive: true });
        }
        if (!fs.existsSync(this.sessionsPath)) {
            fs.writeFileSync(this.sessionsPath, '', 'utf8');
        }
        if (!fs.existsSync(this.configPath)) {
            const defaultConfig = {
                amp: '1.0',
                project: config?.project || path.basename(path.dirname(this.dir)),
                stack: config?.stack || {},
                config: {
                    autoCapture: true,
                    maxEntries: 1000,
                    rotationStrategy: 'archive',
                    inject: ['all'],
                    ...config?.config,
                },
            };
            fs.writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');
        }
    }
    /**
     * Check if AMP is initialized in this workspace
     */
    isInitialized() {
        return fs.existsSync(this.sessionsPath);
    }
    // ─── Read ───────────────────────────────────────────────────────────────────
    /**
     * Read all entries from sessions.jsonl
     */
    readAll() {
        if (!fs.existsSync(this.sessionsPath)) {
            return [];
        }
        const content = fs.readFileSync(this.sessionsPath, 'utf8');
        return content
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
            try {
                return JSON.parse(line);
            }
            catch {
                return null;
            }
        })
            .filter((e) => e !== null);
    }
    /**
     * Search entries with filters
     */
    search(options = {}) {
        let entries = this.readAll();
        if (options.type) {
            entries = entries.filter(e => e.type === options.type);
        }
        if (options.file) {
            const normalized = options.file.replace(/\\/g, '/');
            entries = entries.filter(e => e.file && e.file.replace(/\\/g, '/').includes(normalized));
        }
        if (options.tags && options.tags.length > 0) {
            entries = entries.filter(e => e.tags && options.tags.some(t => e.tags.includes(t)));
        }
        if (options.since) {
            entries = entries.filter(e => e.ts >= options.since);
        }
        if (options.query) {
            const lower = options.query.toLowerCase();
            entries = entries.filter(e => e.msg.toLowerCase().includes(lower) ||
                (e.file && e.file.toLowerCase().includes(lower)) ||
                (e.tags && e.tags.some(t => t.toLowerCase().includes(lower))));
        }
        if (options.limit) {
            entries = entries.slice(-options.limit);
        }
        return entries;
    }
    /**
     * Get entries relevant to a specific file
     */
    forFile(relativePath) {
        return this.search({ file: relativePath });
    }
    // ─── Write ──────────────────────────────────────────────────────────────────
    /**
     * Write a new entry to sessions.jsonl
     */
    write(entry) {
        if (!fs.existsSync(this.dir)) {
            fs.mkdirSync(this.dir, { recursive: true });
        }
        const full = {
            ...entry,
            ts: entry.ts || Date.now(),
            id: entry.id || `amp_${generateULID()}`,
        };
        // Sanitize: reject secrets
        if (this.containsSecret(full.msg)) {
            throw new Error('Entry appears to contain a secret (API key, token). Not stored.');
        }
        // Sanitize: strip absolute paths
        if (full.file && path.isAbsolute(full.file)) {
            full.file = path.relative(path.dirname(this.dir), full.file).replace(/\\/g, '/');
        }
        const line = JSON.stringify(full) + '\n';
        fs.appendFileSync(this.sessionsPath, line, 'utf8');
        // Check rotation
        this.checkRotation();
        return full;
    }
    /**
     * Convenience: log a gotcha
     */
    gotcha(msg, file, line) {
        return this.write({ type: 'gotcha', msg, file, line });
    }
    /**
     * Convenience: log a decision
     */
    decision(msg) {
        return this.write({ type: 'decision', msg });
    }
    /**
     * Convenience: log a failed attempt
     */
    attempt(msg, file) {
        return this.write({ type: 'attempt', msg, file });
    }
    /**
     * Convenience: log a note
     */
    note(msg) {
        return this.write({ type: 'note', msg });
    }
    // ─── Handoff ────────────────────────────────────────────────────────────────
    /**
     * Generate a handoff document from current entries
     */
    handoff(options = {}) {
        const config = this.getConfig();
        const maxEntries = options.maxEntries || config?.config?.handoff?.maxEntries || 20;
        const includeOlderGotchas = options.includeOlderGotchas ?? config?.config?.handoff?.includeOlderGotchas ?? true;
        const all = this.readAll();
        const recent = all.slice(-maxEntries);
        // Always include all gotchas if configured
        let gotchas;
        if (includeOlderGotchas) {
            gotchas = all.filter(e => e.type === 'gotcha');
        }
        else {
            gotchas = recent.filter(e => e.type === 'gotcha');
        }
        const attempts = recent.filter(e => e.type === 'attempt');
        const decisions = recent.filter(e => e.type === 'decision');
        const notes = recent.filter(e => e.type === 'note');
        if (options.format === 'json') {
            return JSON.stringify({ gotchas, attempts, decisions, notes, health: this.health() }, null, 2);
        }
        return this.renderMarkdownHandoff(gotchas, attempts, decisions, notes, all.length);
    }
    renderMarkdownHandoff(gotchas, attempts, decisions, notes, totalEntries) {
        const { score, grade } = this.health();
        const project = this.getConfig()?.project || 'unknown';
        let output = `# 🔥 AI Memory Handoff\n\n`;
        output += `> Project: ${project} | Entries: ${totalEntries} | Health: ${grade} (${score}/100)\n\n`;
        output += `---\n\n`;
        if (gotchas.length) {
            output += `## ⚠️ GOTCHAS — Read First\n\n`;
            gotchas.forEach((g, i) => {
                output += `${i + 1}. **${g.msg}**`;
                if (g.file) {
                    output += ` (\`${g.file}${g.line ? ':' + g.line : ''}\`)`;
                }
                output += '\n';
            });
            output += '\n';
        }
        if (attempts.length) {
            output += `## ❌ FAILED — Don't Repeat\n\n`;
            attempts.forEach((a, i) => {
                output += `${i + 1}. ~~${a.msg}~~`;
                if (a.file) {
                    output += ` (\`${a.file}\`)`;
                }
                output += '\n';
            });
            output += '\n';
        }
        if (decisions.length) {
            output += `## ✓ DECISIONS — Follow These\n\n`;
            decisions.forEach((d, i) => {
                output += `${i + 1}. ${d.msg}\n`;
            });
            output += '\n';
        }
        if (notes.length) {
            output += `## 📝 Context\n\n`;
            notes.slice(-5).forEach(n => {
                output += `- ${n.msg}\n`;
            });
            output += '\n';
        }
        output += `---\n\n`;
        output += `*Generated by AMP v1.0 · ${new Date().toISOString().split('T')[0]}*\n`;
        return output;
    }
    // ─── Injection ──────────────────────────────────────────────────────────────
    /**
     * Inject handoff into platform-specific files
     */
    inject(workspaceRoot) {
        const config = this.getConfig();
        const targets = config?.config?.inject || ['all'];
        const handoffContent = this.handoff();
        const injected = [];
        const MARKER_START = '<!-- AMP:START -->';
        const MARKER_END = '<!-- AMP:END -->';
        const wrapped = `${MARKER_START}\n## AI Memory (auto-generated — do not edit)\n\n${handoffContent}\n${MARKER_END}`;
        const platformFiles = {
            copilot: path.join(workspaceRoot, '.github', 'copilot-instructions.md'),
            cursor: path.join(workspaceRoot, '.cursorrules'),
            claude: path.join(workspaceRoot, 'CLAUDE.md'),
            windsurf: path.join(workspaceRoot, '.windsurfrules'),
        };
        const shouldInject = (platform) => targets.includes('all') || targets.includes(platform);
        for (const [platform, filePath] of Object.entries(platformFiles)) {
            if (!shouldInject(platform))
                continue;
            try {
                let content = '';
                if (fs.existsSync(filePath)) {
                    content = fs.readFileSync(filePath, 'utf8');
                }
                // Replace between markers, or append
                const startIdx = content.indexOf(MARKER_START);
                const endIdx = content.indexOf(MARKER_END);
                if (startIdx !== -1 && endIdx !== -1) {
                    content = content.substring(0, startIdx) + wrapped + content.substring(endIdx + MARKER_END.length);
                }
                else {
                    content = content.trimEnd() + '\n\n' + wrapped + '\n';
                }
                // Ensure directory exists
                const dir = path.dirname(filePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(filePath, content, 'utf8');
                injected.push(platform);
            }
            catch {
                // Skip platforms we can't write to
            }
        }
        return injected;
    }
    // ─── Health ─────────────────────────────────────────────────────────────────
    /**
     * Calculate session health score
     */
    health() {
        const entries = this.readAll();
        const gotchas = entries.filter(e => e.type === 'gotcha').length;
        const decisions = entries.filter(e => e.type === 'decision').length;
        const attempts = entries.filter(e => e.type === 'attempt').length;
        const notes = entries.filter(e => e.type === 'note').length;
        let score = 0;
        score += Math.min(gotchas * 20, 40);
        score += Math.min(decisions * 15, 30);
        score += Math.min(attempts * 15, 20);
        score += Math.min(notes * 5, 10);
        score = Math.min(score, 100);
        let grade = 'F';
        if (score >= 80)
            grade = 'A';
        else if (score >= 60)
            grade = 'B';
        else if (score >= 40)
            grade = 'C';
        else if (score >= 20)
            grade = 'D';
        return { score, grade };
    }
    // ─── Config ─────────────────────────────────────────────────────────────────
    /**
     * Get project configuration
     */
    getConfig() {
        if (!fs.existsSync(this.configPath))
            return null;
        try {
            return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        }
        catch {
            return null;
        }
    }
    // ─── Rotation ───────────────────────────────────────────────────────────────
    checkRotation() {
        const config = this.getConfig();
        const maxEntries = config?.config?.maxEntries || 1000;
        const strategy = config?.config?.rotationStrategy || 'archive';
        const entries = this.readAll();
        if (entries.length <= maxEntries)
            return;
        if (strategy === 'none')
            return;
        const toKeep = entries.slice(-maxEntries);
        const toArchive = entries.slice(0, entries.length - maxEntries);
        if (strategy === 'archive') {
            const archiveDir = path.join(this.dir, 'archive');
            if (!fs.existsSync(archiveDir)) {
                fs.mkdirSync(archiveDir, { recursive: true });
            }
            const month = new Date().toISOString().slice(0, 7); // YYYY-MM
            const archivePath = path.join(archiveDir, `${month}.jsonl`);
            const archiveContent = toArchive.map(e => JSON.stringify(e)).join('\n') + '\n';
            fs.appendFileSync(archivePath, archiveContent, 'utf8');
        }
        // Rewrite main file with kept entries
        const content = toKeep.map(e => JSON.stringify(e)).join('\n') + '\n';
        fs.writeFileSync(this.sessionsPath, content, 'utf8');
    }
    // ─── Security ───────────────────────────────────────────────────────────────
    containsSecret(text) {
        const patterns = [
            /sk-[a-zA-Z0-9]{20,}/, // OpenAI keys
            /ghp_[a-zA-Z0-9]{36}/, // GitHub PATs
            /gho_[a-zA-Z0-9]{36}/, // GitHub OAuth
            /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY/,
            /AKIA[0-9A-Z]{16}/, // AWS access keys
            /eyJ[a-zA-Z0-9_-]{50,}\./, // JWTs
            /xox[bpras]-[a-zA-Z0-9-]{10,}/, // Slack tokens
        ];
        return patterns.some(p => p.test(text));
    }
}
exports.AMP = AMP;

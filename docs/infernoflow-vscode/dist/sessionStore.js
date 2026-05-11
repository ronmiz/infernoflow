"use strict";
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
exports.SessionStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class SessionStore {
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot;
        this.infernoDir = path.join(workspaceRoot, 'inferno');
        this.filePath = path.join(this.infernoDir, 'sessions.jsonl');
    }
    /**
     * Read all session entries from sessions.jsonl
     */
    getAll() {
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
                    return JSON.parse(line);
                }
                catch {
                    return null;
                }
            })
                .filter((entry) => entry !== null);
        }
        catch {
            return [];
        }
    }
    /**
     * Get entries filtered by type
     */
    getByType(type) {
        return this.getAll().filter(e => e.type === type);
    }
    /**
     * Get entries that reference a specific file
     */
    getForFile(relativePath) {
        const normalized = relativePath.replace(/\\/g, '/');
        return this.getAll().filter(e => {
            if (!e.file) {
                return false;
            }
            return e.file.replace(/\\/g, '/').includes(normalized) ||
                normalized.includes(e.file.replace(/\\/g, '/'));
        });
    }
    /**
     * Append a new entry to sessions.jsonl
     */
    append(entry) {
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
    log(type, msg, file, line) {
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
    search(query) {
        const lower = query.toLowerCase();
        return this.getAll().filter(e => e.msg.toLowerCase().includes(lower) ||
            e.type.includes(lower) ||
            (e.file && e.file.toLowerCase().includes(lower)));
    }
    /**
     * Calculate session health score (0-100)
     */
    getHealthScore() {
        const entries = this.getAll();
        const gotchas = entries.filter(e => e.type === 'gotcha').length;
        const decisions = entries.filter(e => e.type === 'decision').length;
        const attempts = entries.filter(e => e.type === 'attempt').length;
        const notes = entries.filter(e => e.type === 'note').length;
        // Scoring: gotchas are most valuable
        let score = 0;
        score += Math.min(gotchas * 20, 40); // up to 40 points for gotchas
        score += Math.min(decisions * 15, 30); // up to 30 points for decisions
        score += Math.min(attempts * 15, 20); // up to 20 points for attempts
        score += Math.min(notes * 5, 10); // up to 10 points for notes
        score = Math.min(score, 100);
        let grade = 'F';
        if (score >= 80) {
            grade = 'A';
        }
        else if (score >= 60) {
            grade = 'B';
        }
        else if (score >= 40) {
            grade = 'C';
        }
        else if (score >= 20) {
            grade = 'D';
        }
        return { score, grade };
    }
    /**
     * Generate a handoff/switch summary
     */
    generateHandoff() {
        const entries = this.getAll();
        const gotchas = entries.filter(e => e.type === 'gotcha');
        const decisions = entries.filter(e => e.type === 'decision');
        const attempts = entries.filter(e => e.type === 'attempt');
        const notes = entries.filter(e => e.type === 'note');
        const { score, grade } = this.getHealthScore();
        let output = `## 🔥 infernoflow — Agent Handoff\n`;
        output += `**Session health:** ${grade} (${score}/100)\n\n`;
        if (gotchas.length) {
            output += `### ⚠️ Gotchas (don't repeat these)\n`;
            gotchas.forEach(g => {
                output += `- ${g.msg}`;
                if (g.file) {
                    output += ` (${g.file})`;
                }
                output += '\n';
            });
            output += '\n';
        }
        if (attempts.length) {
            output += `### ❌ Failed Attempts (don't try these again)\n`;
            attempts.forEach(a => {
                output += `- ${a.msg}`;
                if (a.file) {
                    output += ` (${a.file})`;
                }
                output += '\n';
            });
            output += '\n';
        }
        if (decisions.length) {
            output += `### ✓ Decisions Made (follow these)\n`;
            decisions.forEach(d => output += `- ${d.msg}\n`);
            output += '\n';
        }
        if (notes.length) {
            output += `### 📝 Notes\n`;
            const recentNotes = notes.slice(-5); // last 5
            recentNotes.forEach(n => output += `- ${n.msg}\n`);
            output += '\n';
        }
        return output;
    }
    /**
     * Generate a recap summary
     */
    generateRecap() {
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
    exists() {
        return fs.existsSync(this.filePath);
    }
}
exports.SessionStore = SessionStore;
//# sourceMappingURL=sessionStore.js.map
"use strict";
/**
 * AMP Usage Examples
 *
 * Demonstrates how to use the AI Memory Protocol reference implementation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const amp_1 = require("./amp");
// ─── Basic Usage ──────────────────────────────────────────────────────────────
const amp = new amp_1.AMP('/path/to/project');
// Initialize (creates .ai-memory/ folder)
amp.init({
    project: 'my-app',
    stack: { language: 'typescript', framework: 'react' },
});
// ─── Writing Entries ──────────────────────────────────────────────────────────
// Quick helpers
amp.gotcha('API requires auth header even for public endpoints', 'src/api.ts', 42);
amp.decision('Use axios for all HTTP calls');
amp.attempt('Tried fetch — CORS issues with dev proxy', 'src/api.ts');
amp.note('Search is client-side only for now');
// Full control
amp.write({
    type: 'gotcha',
    msg: 'Modal z-index conflicts with toasts',
    file: 'src/components/Modal.tsx',
    line: 15,
    tags: ['css', 'ui'],
    tool: 'copilot',
});
// ─── Reading & Searching ──────────────────────────────────────────────────────
// Get all entries
const all = amp.readAll();
// Search by keyword
const authIssues = amp.search({ query: 'auth' });
// Search by type
const gotchas = amp.search({ type: 'gotcha' });
// Search by file
const apiEntries = amp.forFile('src/api.ts');
// Search by tags
const cssIssues = amp.search({ tags: ['css'] });
// Combined search
const recentGotchas = amp.search({
    type: 'gotcha',
    since: Date.now() - 7 * 24 * 60 * 60 * 1000, // last 7 days
    limit: 10,
});
// ─── Generating Handoffs ──────────────────────────────────────────────────────
// Markdown handoff (for pasting into AI chats)
const markdown = amp.handoff();
console.log(markdown);
// JSON handoff (for programmatic use)
const json = amp.handoff({ format: 'json' });
// ─── Injecting into Platform Files ────────────────────────────────────────────
// Writes handoff into .cursorrules, copilot-instructions.md, CLAUDE.md etc.
const injected = amp.inject('/path/to/project');
console.log(`Injected into: ${injected.join(', ')}`);
// ─── Health Score ─────────────────────────────────────────────────────────────
const { score, grade } = amp.health();
console.log(`Session health: ${grade} (${score}/100)`);

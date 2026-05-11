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
export type EntryType = 'gotcha' | 'decision' | 'attempt' | 'note' | 'detection' | 'pattern';
export interface AMPEntry {
    type: EntryType;
    msg: string;
    ts: number;
    id?: string;
    file?: string;
    line?: number;
    function?: string;
    tags?: string[];
    source?: string;
    tool?: 'copilot' | 'cursor' | 'claude' | 'windsurf' | 'other';
    session?: string;
    confidence?: number;
    related?: string[];
    meta?: Record<string, unknown>;
}
export interface AMPConfig {
    amp: string;
    project?: string;
    stack?: {
        language?: string;
        framework?: string;
        runtime?: string;
    };
    config?: {
        autoCapture?: boolean;
        maxEntries?: number;
        rotationStrategy?: 'archive' | 'prune-old' | 'none';
        inject?: string[];
        handoff?: {
            maxEntries?: number;
            includeOlderGotchas?: boolean;
        };
    };
}
export interface HealthScore {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
}
export interface HandoffOptions {
    maxEntries?: number;
    includeOlderGotchas?: boolean;
    format?: 'markdown' | 'json';
}
export interface SearchOptions {
    query?: string;
    type?: EntryType;
    file?: string;
    tags?: string[];
    limit?: number;
    since?: number;
}
export declare class AMP {
    private dir;
    private sessionsPath;
    private configPath;
    constructor(workspaceRoot: string);
    /**
     * Initialize AMP in the workspace. Creates .ai-memory/ directory and files.
     */
    init(config?: Partial<AMPConfig>): void;
    /**
     * Check if AMP is initialized in this workspace
     */
    isInitialized(): boolean;
    /**
     * Read all entries from sessions.jsonl
     */
    readAll(): AMPEntry[];
    /**
     * Search entries with filters
     */
    search(options?: SearchOptions): AMPEntry[];
    /**
     * Get entries relevant to a specific file
     */
    forFile(relativePath: string): AMPEntry[];
    /**
     * Write a new entry to sessions.jsonl
     */
    write(entry: Omit<AMPEntry, 'ts'> & {
        ts?: number;
    }): AMPEntry;
    /**
     * Convenience: log a gotcha
     */
    gotcha(msg: string, file?: string, line?: number): AMPEntry;
    /**
     * Convenience: log a decision
     */
    decision(msg: string): AMPEntry;
    /**
     * Convenience: log a failed attempt
     */
    attempt(msg: string, file?: string): AMPEntry;
    /**
     * Convenience: log a note
     */
    note(msg: string): AMPEntry;
    /**
     * Generate a handoff document from current entries
     */
    handoff(options?: HandoffOptions): string;
    private renderMarkdownHandoff;
    /**
     * Inject handoff into platform-specific files
     */
    inject(workspaceRoot: string): string[];
    /**
     * Calculate session health score
     */
    health(): HealthScore;
    /**
     * Get project configuration
     */
    getConfig(): AMPConfig | null;
    private checkRotation;
    private containsSecret;
}

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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
// ── CLI runner ────────────────────────────────────────────────────────────────
function getCli() {
    const config = vscode.workspace.getConfiguration("infernoflow");
    return config.get("cliPath") || "infernoflow";
}
function getCwd() {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
function runCli(args) {
    const cwd = getCwd();
    if (!cwd)
        return { stdout: "", stderr: "No workspace folder open", status: 1 };
    const cli = getCli();
    const result = (0, child_process_1.spawnSync)(cli, args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        timeout: 30000,
    });
    return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        status: result.status ?? 1,
    };
}
function loadStatus(cwd) {
    // Read files directly — faster than spawning CLI for status
    const infernoDir = path.join(cwd, "inferno");
    const contractPath = path.join(infernoDir, "contract.json");
    const capsPath = path.join(infernoDir, "capabilities.json");
    const scenariosDir = path.join(infernoDir, "scenarios");
    const changelogPath = path.join(infernoDir, "CHANGELOG.md");
    if (!fs.existsSync(contractPath)) {
        return { ok: false, error: "inferno/contract.json not found" };
    }
    try {
        const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
        const capsReg = fs.existsSync(capsPath)
            ? JSON.parse(fs.readFileSync(capsPath, "utf8"))
            : null;
        // Collect covered capabilities from scenarios
        const covered = new Set();
        if (fs.existsSync(scenariosDir)) {
            for (const f of fs.readdirSync(scenariosDir).filter((n) => n.endsWith(".json"))) {
                try {
                    const s = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
                    (s.capabilitiesCovered || []).forEach((c) => covered.add(c));
                }
                catch { }
            }
        }
        const scenarioFiles = fs.existsSync(scenariosDir)
            ? fs.readdirSync(scenariosDir).filter((n) => n.endsWith(".json")).length
            : 0;
        const caps = contract.capabilities || [];
        const capDetails = caps.map((id) => {
            const reg = (capsReg?.capabilities || []).find((c) => c.id === id);
            return { id, title: reg?.title, since: reg?.since, covered: covered.has(id) };
        });
        const changelog = fs.existsSync(changelogPath)
            ? fs.readFileSync(changelogPath, "utf8")
            : "";
        const hasUnreleased = /##\s+Unreleased/i.test(changelog);
        return {
            ok: true,
            policyId: contract.policyId,
            policyVersion: contract.policyVersion,
            capabilities: caps,
            capabilityDetails: capDetails,
            scenarioCount: scenarioFiles,
            coveredCapabilities: [...covered],
            hasUnreleased,
        };
    }
    catch (e) {
        return { ok: false, error: e.message };
    }
}
// ── Tree items ────────────────────────────────────────────────────────────────
class CapabilityItem extends vscode.TreeItem {
    constructor(cap) {
        super(cap.id, vscode.TreeItemCollapsibleState.None);
        this.description = cap.title || "";
        this.tooltip = [
            `ID: ${cap.id}`,
            cap.title ? `Title: ${cap.title}` : null,
            cap.since ? `Since: ${cap.since}` : null,
            `Coverage: ${cap.covered ? "✔ covered" : "✘ no scenario"}`,
        ]
            .filter(Boolean)
            .join("\n");
        this.iconPath = new vscode.ThemeIcon(cap.covered ? "pass-filled" : "circle-outline", cap.covered
            ? new vscode.ThemeColor("testing.iconPassed")
            : new vscode.ThemeColor("testing.iconUnset"));
        this.contextValue = "capability";
    }
}
class InfoItem extends vscode.TreeItem {
    constructor(label, description, icon) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.description = description;
        if (icon)
            this.iconPath = new vscode.ThemeIcon(icon);
    }
}
class SectionItem extends vscode.TreeItem {
    constructor(label, collapsible = vscode.TreeItemCollapsibleState.Collapsed) {
        super(label, collapsible);
        this.contextValue = "section";
    }
}
// ── Capabilities tree provider ────────────────────────────────────────────────
class CapabilitiesProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.status = null;
    }
    refresh() {
        const cwd = getCwd();
        this.status = cwd ? loadStatus(cwd) : null;
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!this.status) {
            return [new InfoItem("No workspace open", undefined, "folder")];
        }
        if (!this.status.ok) {
            return [
                new InfoItem("infernoflow not initialised", undefined, "warning"),
                new InfoItem("Run: infernoflow init", undefined, "terminal"),
            ];
        }
        if (!element) {
            // Root: project summary + capabilities
            const caps = this.status.capabilityDetails || [];
            const covered = caps.filter((c) => c.covered).length;
            const total = caps.length;
            const items = [
                new InfoItem(`${this.status.policyId}`, `v${this.status.policyVersion}`, "project"),
                new InfoItem(`${covered}/${total} capabilities covered`, undefined, covered === total ? "pass-filled" : "warning"),
                new InfoItem(`${this.status.scenarioCount} scenario${this.status.scenarioCount !== 1 ? "s" : ""}`, undefined, "beaker"),
                new InfoItem(this.status.hasUnreleased ? "## Unreleased ready" : "No unreleased changes", undefined, this.status.hasUnreleased ? "edit" : "circle-outline"),
            ];
            // Divider then capabilities
            items.push(new InfoItem("─────────────────", undefined));
            for (const cap of caps) {
                items.push(new CapabilityItem(cap));
            }
            if (caps.length === 0) {
                items.push(new InfoItem("No capabilities yet", "Run infernoflow init", "add"));
            }
            return items;
        }
        return [];
    }
}
// ── Scenarios tree provider ───────────────────────────────────────────────────
class ScenariosProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() { this._onDidChangeTreeData.fire(); }
    getTreeItem(el) { return el; }
    getChildren() {
        const cwd = getCwd();
        if (!cwd)
            return [new InfoItem("No workspace", undefined, "folder")];
        const scenariosDir = path.join(cwd, "inferno", "scenarios");
        if (!fs.existsSync(scenariosDir)) {
            return [new InfoItem("No scenarios directory", "Run infernoflow init", "warning")];
        }
        const files = fs.readdirSync(scenariosDir).filter((f) => f.endsWith(".json"));
        if (!files.length) {
            return [new InfoItem("No scenario files yet", undefined, "info")];
        }
        return files.map((f) => {
            try {
                const s = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
                const steps = s.steps?.length || 0;
                const caps = (s.capabilitiesCovered || []).length;
                const item = new vscode.TreeItem(f, vscode.TreeItemCollapsibleState.None);
                item.description = `${steps} steps · ${caps} caps`;
                item.iconPath = new vscode.ThemeIcon("beaker");
                item.command = {
                    command: "vscode.open",
                    title: "Open scenario",
                    arguments: [vscode.Uri.file(path.join(scenariosDir, f))],
                };
                return item;
            }
            catch {
                const item = new vscode.TreeItem(f, vscode.TreeItemCollapsibleState.None);
                item.description = "invalid JSON";
                item.iconPath = new vscode.ThemeIcon("error");
                return item;
            }
        });
    }
}
// ── Changelog tree provider ───────────────────────────────────────────────────
class ChangelogProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }
    refresh() { this._onDidChangeTreeData.fire(); }
    getTreeItem(el) { return el; }
    getChildren() {
        const cwd = getCwd();
        if (!cwd)
            return [new InfoItem("No workspace", undefined, "folder")];
        const changelogPath = path.join(cwd, "inferno", "CHANGELOG.md");
        if (!fs.existsSync(changelogPath)) {
            return [new InfoItem("No inferno/CHANGELOG.md", "Run infernoflow init", "warning")];
        }
        const text = fs.readFileSync(changelogPath, "utf8");
        const sections = [];
        let currentSection = null;
        let itemCount = 0;
        for (const line of text.split("\n")) {
            if (/^##\s/.test(line)) {
                currentSection = line.replace(/^##\s+/, "").trim();
                itemCount = 0;
                const item = new vscode.TreeItem(currentSection, vscode.TreeItemCollapsibleState.None);
                item.iconPath = new vscode.ThemeIcon(currentSection.toLowerCase().includes("unreleased") ? "edit" : "tag");
                sections.push(item);
            }
            else if (currentSection && line.startsWith("- ") && itemCount < 5) {
                const bullet = new vscode.TreeItem(line.slice(2), vscode.TreeItemCollapsibleState.None);
                bullet.iconPath = new vscode.ThemeIcon("circle-filled");
                bullet.description = "";
                sections.push(bullet);
                itemCount++;
            }
            if (sections.length > 30)
                break;
        }
        if (!sections.length) {
            return [new InfoItem("Empty changelog", undefined, "info")];
        }
        return sections;
    }
}
// ── Status bar ────────────────────────────────────────────────────────────────
function createStatusBarItem() {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.command = "infernoflow.refresh";
    return item;
}
function updateStatusBar(item, status) {
    if (!status) {
        item.hide();
        return;
    }
    if (!status.ok) {
        item.text = "$(flame) infernoflow: not init";
        item.tooltip = status.error || "Run infernoflow init";
        item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        item.show();
        return;
    }
    const caps = status.capabilityDetails || [];
    const covered = caps.filter((c) => c.covered).length;
    const total = caps.length;
    const allCovered = covered === total;
    item.text = allCovered
        ? `$(pass-filled) infernoflow: ${total} caps`
        : `$(warning) infernoflow: ${covered}/${total} covered`;
    item.tooltip = [
        `infernoflow — ${status.policyId} v${status.policyVersion}`,
        `Capabilities: ${total}`,
        `Coverage: ${covered}/${total}`,
        status.hasUnreleased ? "Unreleased changes ready" : "No unreleased changes",
        "",
        "Click to refresh",
    ].join("\n");
    item.backgroundColor = allCovered
        ? undefined
        : new vscode.ThemeColor("statusBarItem.warningBackground");
    item.show();
}
// ── Auto-refresh ──────────────────────────────────────────────────────────────
function startAutoRefresh(capsProvider, scenProvider, chgProvider, statusBar) {
    let timer = null;
    const schedule = () => {
        if (timer)
            clearInterval(timer);
        const config = vscode.workspace.getConfiguration("infernoflow");
        const interval = (config.get("autoRefreshInterval") ?? 30) * 1000;
        if (interval > 0) {
            timer = setInterval(() => {
                capsProvider.refresh();
                scenProvider.refresh();
                chgProvider.refresh();
                const cwd = getCwd();
                const status = cwd ? loadStatus(cwd) : null;
                updateStatusBar(statusBar, status);
            }, interval);
        }
    };
    schedule();
    const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("infernoflow"))
            schedule();
    });
    return {
        dispose: () => {
            if (timer)
                clearInterval(timer);
            configWatcher.dispose();
        },
    };
}
// ── Activate ──────────────────────────────────────────────────────────────────
function activate(context) {
    const capsProvider = new CapabilitiesProvider();
    const scenProvider = new ScenariosProvider();
    const chgProvider = new ChangelogProvider();
    vscode.window.registerTreeDataProvider("infernoflow.capabilities", capsProvider);
    vscode.window.registerTreeDataProvider("infernoflow.scenarios", scenProvider);
    vscode.window.registerTreeDataProvider("infernoflow.changelog", chgProvider);
    // Status bar
    const statusBar = createStatusBarItem();
    context.subscriptions.push(statusBar);
    // Initial load
    const doRefresh = () => {
        capsProvider.refresh();
        scenProvider.refresh();
        chgProvider.refresh();
        const cwd = getCwd();
        const status = cwd ? loadStatus(cwd) : null;
        updateStatusBar(statusBar, status);
    };
    doRefresh();
    // Auto-refresh
    const autoRefresh = startAutoRefresh(capsProvider, scenProvider, chgProvider, statusBar);
    context.subscriptions.push(autoRefresh);
    // File watcher — refresh when inferno/ files change
    const watcher = vscode.workspace.createFileSystemWatcher("**/inferno/**/*.{json,md}");
    watcher.onDidChange(doRefresh);
    watcher.onDidCreate(doRefresh);
    watcher.onDidDelete(doRefresh);
    context.subscriptions.push(watcher);
    // ── Commands ────────────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand("infernoflow.refresh", doRefresh), vscode.commands.registerCommand("infernoflow.check", async () => {
        const terminal = vscode.window.createTerminal("infernoflow check");
        terminal.sendText(`${getCli()} check`);
        terminal.show();
    }), vscode.commands.registerCommand("infernoflow.updateContext", async () => {
        const terminal = vscode.window.createTerminal("infernoflow context");
        terminal.sendText(`${getCli()} context`);
        terminal.show();
        // Refresh after a short delay to pick up new CONTEXT.md
        setTimeout(doRefresh, 2000);
    }), vscode.commands.registerCommand("infernoflow.openContext", async () => {
        const cwd = getCwd();
        if (!cwd)
            return;
        const contextPath = path.join(cwd, "inferno", "CONTEXT.md");
        if (!fs.existsSync(contextPath)) {
            vscode.window.showWarningMessage("CONTEXT.md not found. Run infernoflow context first.", "Run now").then((choice) => {
                if (choice === "Run now") {
                    vscode.commands.executeCommand("infernoflow.updateContext");
                }
            });
            return;
        }
        vscode.window.showTextDocument(vscode.Uri.file(contextPath));
    }), vscode.commands.registerCommand("infernoflow.openCapabilities", async () => {
        const cwd = getCwd();
        if (!cwd)
            return;
        const capsPath = path.join(cwd, "inferno", "capabilities.json");
        if (fs.existsSync(capsPath)) {
            vscode.window.showTextDocument(vscode.Uri.file(capsPath));
        }
        else {
            vscode.window.showWarningMessage("capabilities.json not found. Run infernoflow init first.");
        }
    }), vscode.commands.registerCommand("infernoflow.changelogUpdate", async () => {
        const terminal = vscode.window.createTerminal("infernoflow changelog");
        terminal.sendText(`${getCli()} changelog update`);
        terminal.show();
        setTimeout(doRefresh, 3000);
    }), vscode.commands.registerCommand("infernoflow.diff", async () => {
        const terminal = vscode.window.createTerminal("infernoflow diff");
        terminal.sendText(`${getCli()} diff`);
        terminal.show();
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map
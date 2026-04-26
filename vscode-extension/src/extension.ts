import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { execSync, spawnSync } from "child_process";

// ── VS Code Language Model API (Tier 1 AI — Copilot: Gemini, Claude, GPT, etc.) ──

async function callVsCodeLM(prompt: string): Promise<string | null> {
  try {
    // Select the best available Copilot model — user's active choice
    const [model] = await vscode.lm.selectChatModels({
      vendor: "copilot",
      family: "gpt-4o", // fallback family; VS Code picks the best match
    });
    if (!model) return null;

    const messages = [vscode.LanguageModelChatMessage.User(prompt)];
    const response  = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);

    let text = "";
    for await (const chunk of response.text) {
      text += chunk;
    }
    return text || null;
  } catch {
    // vscode.lm not available (older VS Code, no Copilot) — fall through to CLI provider
    return null;
  }
}

/**
 * AI suggest via VS Code LM API first, then fall back to CLI infernoflow suggest.
 * This means Copilot subscribers (Gemini, Claude opus-4.6, GPT-4o, etc.) get
 * zero-config AI sync — no extra API key needed.
 */
async function aiSuggest(description: string, cwd: string): Promise<"vscodelm" | "cli" | "none"> {
  // Build the suggest prompt from the contract
  const infernoDir   = path.join(cwd, "inferno");
  const contractPath = path.join(infernoDir, "contract.json");
  const capsPath     = path.join(infernoDir, "capabilities.json");

  if (!fs.existsSync(contractPath)) return "none";

  const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
  const caps     = contract.capabilities || [];

  const prompt = [
    `You are a capability contract assistant for an infernoflow project.`,
    `Current capabilities: ${caps.join(", ")}`,
    `The developer just made this change: "${description}"`,
    ``,
    `Return ONLY a JSON object in this format (no markdown, no explanation):`,
    `{"newCapabilities":[],"updatedCapabilities":[],"removedCapabilities":[],"summary":"one sentence"}`,
  ].join("\n");

  const text = await callVsCodeLM(prompt);
  if (text) {
    // Try to parse and apply
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const result = JSON.parse(match[0]);
        // Apply: add new capabilities to contract
        if (result.newCapabilities?.length) {
          const newCaps = [...caps, ...result.newCapabilities.filter((c: string) => !caps.includes(c))];
          contract.capabilities = newCaps;
          fs.writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
        }
        return "vscodelm";
      }
    } catch {}
  }

  // Fall back to CLI (which tries Anthropic/OpenAI/Gemini/Ollama)
  const r = spawnSync(getCli(), ["suggest", description, "--json"], {
    cwd, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  return r.status === 0 ? "cli" : "none";
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Capability {
  id: string;
  title?: string;
  since?: string;
  covered?: boolean;
}

interface Agent {
  name: string;
  description?: string;
  steps?: Array<string | { command: string; args?: string[] }>;
  confidence?: number;
}

interface VersionResult {
  ok: boolean;
  bump?: string;
  current?: string;
  next?: string;
  reason?: string[];
}

interface StatusResult {
  ok: boolean;
  policyId?: string;
  policyVersion?: number;
  capabilities?: string[];
  capabilityDetails?: Capability[];
  scenarioCount?: number;
  coveredCapabilities?: string[];
  hasUnreleased?: boolean;
  error?: string;
}

// ── CLI runner ────────────────────────────────────────────────────────────────

function getCli(): string {
  const config = vscode.workspace.getConfiguration("infernoflow");
  return config.get<string>("cliPath") || "infernoflow";
}

function getCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const cwd = getCwd();
  if (!cwd) return { stdout: "", stderr: "No workspace folder open", status: 1 };

  const cli = getCli();
  const result = spawnSync(cli, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 30_000,
  });

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  };
}

function loadStatus(cwd: string): StatusResult {
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
    const covered = new Set<string>();
    if (fs.existsSync(scenariosDir)) {
      for (const f of fs.readdirSync(scenariosDir).filter((n) => n.endsWith(".json"))) {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(scenariosDir, f), "utf8"));
          (s.capabilitiesCovered || []).forEach((c: string) => covered.add(c));
        } catch {}
      }
    }

    const scenarioFiles = fs.existsSync(scenariosDir)
      ? fs.readdirSync(scenariosDir).filter((n) => n.endsWith(".json")).length
      : 0;

    const caps: string[] = contract.capabilities || [];
    const capDetails: Capability[] = caps.map((id) => {
      const reg = (capsReg?.capabilities || []).find((c: Capability) => c.id === id);
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
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ── Tree items ────────────────────────────────────────────────────────────────

class CapabilityItem extends vscode.TreeItem {
  constructor(cap: Capability) {
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
    this.iconPath = new vscode.ThemeIcon(
      cap.covered ? "pass-filled" : "circle-outline",
      cap.covered
        ? new vscode.ThemeColor("testing.iconPassed")
        : new vscode.ThemeColor("testing.iconUnset")
    );
    this.contextValue = "capability";
  }
}

class InfoItem extends vscode.TreeItem {
  constructor(label: string, description?: string, icon?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class SectionItem extends vscode.TreeItem {
  constructor(label: string, collapsible = vscode.TreeItemCollapsibleState.Collapsed) {
    super(label, collapsible);
    this.contextValue = "section";
  }
}

// ── Capabilities tree provider ────────────────────────────────────────────────

class CapabilitiesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private status: StatusResult | null = null;

  refresh(): void {
    const cwd = getCwd();
    this.status = cwd ? loadStatus(cwd) : null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
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

      const items: vscode.TreeItem[] = [
        new InfoItem(
          `${this.status.policyId}`,
          `v${this.status.policyVersion}`,
          "project"
        ),
        new InfoItem(
          `${covered}/${total} capabilities covered`,
          undefined,
          covered === total ? "pass-filled" : "warning"
        ),
        new InfoItem(
          `${this.status.scenarioCount} scenario${this.status.scenarioCount !== 1 ? "s" : ""}`,
          undefined,
          "beaker"
        ),
        new InfoItem(
          this.status.hasUnreleased ? "## Unreleased ready" : "No unreleased changes",
          undefined,
          this.status.hasUnreleased ? "edit" : "circle-outline"
        ),
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

class ScenariosProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }

  getChildren(): vscode.TreeItem[] {
    const cwd = getCwd();
    if (!cwd) return [new InfoItem("No workspace", undefined, "folder")];

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
      } catch {
        const item = new vscode.TreeItem(f, vscode.TreeItemCollapsibleState.None);
        item.description = "invalid JSON";
        item.iconPath = new vscode.ThemeIcon("error");
        return item;
      }
    });
  }
}

// ── Changelog tree provider ───────────────────────────────────────────────────

class ChangelogProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void { this._onDidChangeTreeData.fire(); }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }

  getChildren(): vscode.TreeItem[] {
    const cwd = getCwd();
    if (!cwd) return [new InfoItem("No workspace", undefined, "folder")];

    const changelogPath = path.join(cwd, "inferno", "CHANGELOG.md");
    if (!fs.existsSync(changelogPath)) {
      return [new InfoItem("No inferno/CHANGELOG.md", "Run infernoflow init", "warning")];
    }

    const text = fs.readFileSync(changelogPath, "utf8");
    const sections: vscode.TreeItem[] = [];

    let currentSection: string | null = null;
    let itemCount = 0;

    for (const line of text.split("\n")) {
      if (/^##\s/.test(line)) {
        currentSection = line.replace(/^##\s+/, "").trim();
        itemCount = 0;
        const item = new vscode.TreeItem(currentSection, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(
          currentSection.toLowerCase().includes("unreleased") ? "edit" : "tag"
        );
        sections.push(item);
      } else if (currentSection && line.startsWith("- ") && itemCount < 5) {
        const bullet = new vscode.TreeItem(line.slice(2), vscode.TreeItemCollapsibleState.None);
        bullet.iconPath = new vscode.ThemeIcon("circle-filled");
        bullet.description = "";
        sections.push(bullet);
        itemCount++;
      }
      if (sections.length > 30) break;
    }

    if (!sections.length) {
      return [new InfoItem("Empty changelog", undefined, "info")];
    }

    return sections;
  }
}

// ── Agents tree provider ──────────────────────────────────────────────────────

class AgentsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void { this._onDidChangeTreeData.fire(); }
  getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }

  getChildren(): vscode.TreeItem[] {
    const cwd = getCwd();
    if (!cwd) return [new InfoItem("No workspace", undefined, "folder")];

    const agentsDir = path.join(cwd, "inferno", "agents");
    if (!fs.existsSync(agentsDir)) {
      return [
        new InfoItem("No agents yet", undefined, "info"),
        new InfoItem("Run: infernoflow synthesize", undefined, "terminal"),
      ];
    }

    const files = fs.readdirSync(agentsDir).filter(f => f.endsWith(".json"));
    if (!files.length) {
      return [new InfoItem("No agents found", "Run: infernoflow synthesize", "info")];
    }

    return files.flatMap(f => {
      try {
        const agent: Agent = JSON.parse(fs.readFileSync(path.join(agentsDir, f), "utf8"));
        const steps = (agent.steps || []).map(s => typeof s === "string" ? s : s.command).join(" → ");
        const conf  = agent.confidence ? `${Math.round(agent.confidence * 100)}%` : "";

        const header = new vscode.TreeItem(agent.name, vscode.TreeItemCollapsibleState.None);
        header.description = conf;
        header.tooltip     = `${agent.description || steps}\n\nRun: infernoflow agent run ${agent.name}`;
        header.iconPath    = new vscode.ThemeIcon("play-circle");
        header.command     = {
          command: "infernoflow.runAgent",
          title: "Run agent",
          arguments: [agent.name],
        };

        const detail = new InfoItem(steps, undefined, "arrow-right");
        return [header, detail];
      } catch {
        return [new InfoItem(f, "invalid JSON", "error")];
      }
    });
  }
}

// ── Audit data loader ─────────────────────────────────────────────────────────

interface AuditCapability {
  id:       string;
  severity: "high" | "medium" | "low" | "unknown";
  tags:     string[];
}

interface AuditResult {
  runAt: string;
  capabilities: AuditCapability[];
}

function loadAudit(cwd: string): AuditResult | null {
  const p = path.join(cwd, "inferno", "audit.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

// ── Gutter audit severity decorations ────────────────────────────────────────

const auditDecorationTypes: Record<string, vscode.TextEditorDecorationType> = {};

function getAuditDecorationType(severity: string): vscode.TextEditorDecorationType {
  if (!auditDecorationTypes[severity]) {
    const color = severity === "high"   ? new vscode.ThemeColor("testing.iconFailed")
                : severity === "medium" ? new vscode.ThemeColor("testing.iconQueued")
                :                         new vscode.ThemeColor("testing.iconPassed");
    const badge = severity === "high" ? "🔴" : severity === "medium" ? "🟡" : "🟢";
    auditDecorationTypes[severity] = vscode.window.createTextEditorDecorationType({
      gutterIconSize: "contain",
      before: {
        contentText:  badge,
        margin:       "0 6px 0 0",
        color,
        fontStyle:    "normal",
      },
      overviewRulerColor: severity === "high"   ? new vscode.ThemeColor("editorError.foreground")
                        : severity === "medium" ? new vscode.ThemeColor("editorWarning.foreground")
                        :                         new vscode.ThemeColor("editorInfo.foreground"),
      overviewRulerLane:  vscode.OverviewRulerLane.Left,
    });
  }
  return auditDecorationTypes[severity];
}

function applyAuditDecorations(editor: vscode.TextEditor, auditCaps: AuditCapability[]): void {
  if (!auditCaps.length) return;

  const text  = editor.document.getText();
  const lines = text.split("\n");

  const byseverity: Record<string, vscode.DecorationOptions[]> = {
    high: [], medium: [], low: [],
  };

  for (const cap of auditCaps) {
    if (!byseverity[cap.severity]) continue;
    // Match capability id references in code (camelCase or kebab-case)
    const idVariants = [
      cap.id,
      cap.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()),  // kebab→camel
      cap.id.replace(/([A-Z])/g, "_$1").toLowerCase(),           // camel→snake
    ];
    const pattern = new RegExp(`\\b(${idVariants.join("|")})\\b`, "i");

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        byseverity[cap.severity].push({
          range: new vscode.Range(i, 0, i, 0),
          hoverMessage: new vscode.MarkdownString(
            `**infernoflow audit** — \`${cap.id}\`\n\nSeverity: **${cap.severity.toUpperCase()}**\n\nTags: ${cap.tags.join(", ") || "—"}`
          ),
        });
        break;
      }
    }
  }

  for (const [sev, decs] of Object.entries(byseverity)) {
    editor.setDecorations(getAuditDecorationType(sev), decs);
  }
}

// ── Graph webview panel ───────────────────────────────────────────────────────

let graphPanel: vscode.WebviewPanel | undefined;

function openGraphWebview(context: vscode.ExtensionContext): void {
  const cwd = getCwd();
  if (!cwd) { vscode.window.showWarningMessage("No workspace folder open."); return; }

  if (graphPanel) {
    graphPanel.reveal(vscode.ViewColumn.One);
    refreshGraphWebview(cwd);
    return;
  }

  graphPanel = vscode.window.createWebviewPanel(
    "infernoGraph",
    "🔥 infernoflow — Capability Graph",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  graphPanel.onDidDispose(() => { graphPanel = undefined; });
  refreshGraphWebview(cwd);
}

function refreshGraphWebview(cwd: string): void {
  if (!graphPanel) return;

  // Run infernoflow graph --html to get the HTML file
  const htmlPath = path.join(cwd, "inferno", "graph.html");
  const result = runCli(["graph", "--html"]);

  if (result.status === 0 && fs.existsSync(htmlPath)) {
    try {
      graphPanel.webview.html = fs.readFileSync(htmlPath, "utf8");
      return;
    } catch {}
  }

  // Fallback: load existing graph.html if present
  if (fs.existsSync(htmlPath)) {
    try {
      graphPanel.webview.html = fs.readFileSync(htmlPath, "utf8");
      return;
    } catch {}
  }

  graphPanel.webview.html = `<!DOCTYPE html><html><body style="background:#0f1117;color:#e2e8f0;font-family:sans-serif;padding:40px;text-align:center">
    <h2 style="color:#f97316">🔥 No graph data yet</h2>
    <p style="margin-top:16px;color:#64748b">Run <code style="background:#1e2535;padding:4px 8px;border-radius:4px">infernoflow scan</code> first to build the capability map, then re-open this panel.</p>
  </body></html>`;
}

// ── Dashboard webview panel ───────────────────────────────────────────────────

let dashboardPanel: vscode.WebviewPanel | undefined;

function openDashboardWebview(context: vscode.ExtensionContext): void {
  const cwd = getCwd();
  if (!cwd) { vscode.window.showWarningMessage("No workspace folder open."); return; }

  if (dashboardPanel) {
    dashboardPanel.reveal(vscode.ViewColumn.One);
    refreshDashboardWebview(cwd);
    return;
  }

  dashboardPanel = vscode.window.createWebviewPanel(
    "infernoDashboard",
    "🔥 infernoflow Dashboard",
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  dashboardPanel.onDidDispose(() => { dashboardPanel = undefined; });
  refreshDashboardWebview(cwd);

  // Auto-refresh every 15s while panel is open
  const timer = setInterval(() => {
    if (dashboardPanel) refreshDashboardWebview(cwd);
    else clearInterval(timer);
  }, 15_000);

  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function refreshDashboardWebview(cwd: string): void {
  if (!dashboardPanel) return;

  // Try to get share HTML from CLI (fastest path)
  const result = runCli(["share", "--out", path.join(cwd, "inferno", ".dashboard-preview.html")]);
  const previewPath = path.join(cwd, "inferno", ".dashboard-preview.html");

  if (result.status === 0 && fs.existsSync(previewPath)) {
    try {
      dashboardPanel.webview.html = fs.readFileSync(previewPath, "utf8");
      return;
    } catch {}
  }

  // Fallback: build a simple inline HTML from contract data
  dashboardPanel.webview.html = buildFallbackDashboardHtml(cwd);
}

function buildFallbackDashboardHtml(cwd: string): string {
  const infernoDir = path.join(cwd, "inferno");
  const status     = loadStatus(cwd);
  const audit      = loadAudit(cwd);
  const caps       = status.capabilityDetails || [];
  const projectName = path.basename(cwd);

  const capRows = caps.map(c =>
    `<tr><td><code>${c.id}</code></td><td>${c.title || ""}</td><td>${c.covered ? "✔" : "✘"}</td></tr>`
  ).join("");

  const auditStats = audit
    ? `<p>Security: ${audit.capabilities.filter(c => c.severity === "high").length} high · ${audit.capabilities.filter(c => c.severity === "medium").length} medium</p>`
    : `<p>No audit data — run <code>infernoflow audit</code></p>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: system-ui; padding: 20px; background: #1e1e1e; color: #d4d4d4; }
    h1 { color: #f97316; } table { border-collapse: collapse; width: 100%; }
    td, th { padding: 8px 12px; border-bottom: 1px solid #333; text-align: left; }
    code { background: #2d2d2d; padding: 2px 5px; border-radius: 3px; }
  </style></head><body>
  <h1>🔥 infernoflow — ${projectName}</h1>
  <p>${caps.length} capabilities · ${caps.filter(c => c.covered).length} covered · ${status.scenarioCount || 0} scenarios</p>
  ${auditStats}
  <table><thead><tr><th>ID</th><th>Title</th><th>Covered</th></tr></thead>
  <tbody>${capRows || "<tr><td colspan='3'>No capabilities</td></tr>"}</tbody></table>
  <p style="color:#666;font-size:12px">Auto-refreshes every 15s</p>
  </body></html>`;
}

// ── Quick-pick capability ticket linking ──────────────────────────────────────

async function quickPickLinkCapability(cwd: string): Promise<void> {
  const infernoDir = path.join(cwd, "inferno");
  const status     = loadStatus(cwd);
  const caps       = status.capabilityDetails || [];

  if (!caps.length) {
    vscode.window.showWarningMessage("No capabilities found. Run infernoflow init first.");
    return;
  }

  // Step 1: pick capability
  const capId = await vscode.window.showQuickPick(
    caps.map(c => ({ label: c.id, description: c.title || "" })),
    { placeHolder: "Select capability to link" }
  );
  if (!capId) return;

  // Step 2: pick platform
  const platform = await vscode.window.showQuickPick(
    [
      { label: "$(github) GitHub Issue",  value: "--github" },
      { label: "$(link) Jira Ticket",     value: "--jira" },
      { label: "$(link) Linear Issue",    value: "--linear" },
    ],
    { placeHolder: "Select ticket platform" }
  );
  if (!platform) return;

  // Step 3: enter ticket ID
  const placeholder =
    platform.value === "--github"  ? "Issue number (e.g. 42)" :
    platform.value === "--jira"    ? "Ticket ID (e.g. PROJ-123)" :
                                     "Issue ID (e.g. LIN-456)";

  const ticketId = await vscode.window.showInputBox({ prompt: placeholder, placeHolder: placeholder });
  if (!ticketId) return;

  // Run the link command
  const args = ["link", "--capability", capId.label, platform.value, ticketId];
  const result = runCli(args);

  if (result.status === 0) {
    vscode.window.showInformationMessage(`✓ Linked ${capId.label} → ${ticketId}`);
  } else {
    vscode.window.showErrorMessage(`Link failed: ${result.stderr || result.stdout}`);
  }
}

// ── Inline capability decorations ─────────────────────────────────────────────

let decorationType: vscode.TextEditorDecorationType | null = null;

function getOrCreateDecorationType(): vscode.TextEditorDecorationType {
  if (!decorationType) {
    decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        margin: "0 0 0 12px",
        fontStyle: "italic",
        fontWeight: "normal",
      },
    });
  }
  return decorationType;
}

function applyCapabilityDecorations(editor: vscode.TextEditor, caps: Capability[]): void {
  if (!caps.length) return;

  const decorations: vscode.DecorationOptions[] = [];
  const text  = editor.document.getText();
  const lines = text.split("\n");

  for (const cap of caps) {
    // Match function/method names that resemble the capability id
    const idParts = cap.id.replace(/([A-Z])/g, " $1").toLowerCase().split(/[\s_-]+/).filter(Boolean);
    if (idParts.length < 2) continue;

    // Build a loose regex: all parts must appear near each other
    const pattern = new RegExp(
      `\\b(function|async function|const|let|var)?\\s*(${idParts.join("\\w*")}\\w*)\\s*[=(]`,
      "i"
    );

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        const range = new vscode.Range(i, 0, i, 0);
        decorations.push({
          range,
          renderOptions: {
            after: {
              contentText: ` 🔥 ${cap.id}`,
            },
          },
        });
        break; // one annotation per capability
      }
    }
  }

  editor.setDecorations(getOrCreateDecorationType(), decorations);
}

// ── Status bar ────────────────────────────────────────────────────────────────

function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = "infernoflow.quickActions";
  return item;
}

function loadVersionRecommendation(cwd: string): VersionResult | null {
  try {
    const result = spawnSync(getCli(), ["version", "--json"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 15_000,
    });
    const out = result.stdout?.trim();
    if (out) return JSON.parse(out);
  } catch {}
  return null;
}

function updateStatusBar(
  item: vscode.StatusBarItem,
  status: StatusResult | null,
  versionRec?: VersionResult | null
): void {
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

  const caps      = status.capabilityDetails || [];
  const covered   = caps.filter((c) => c.covered).length;
  const total     = caps.length;
  const allCovered = covered === total;
  const bump       = versionRec?.bump;
  const bumpIcon   = bump === "major" ? "$(error)" : bump === "minor" ? "$(warning)" : bump === "patch" ? "$(info)" : "";

  item.text = [
    allCovered ? "$(pass-filled)" : "$(warning)",
    `infernoflow: ${total} caps`,
    bump && bump !== "none" ? `${bumpIcon} ${bump} bump` : "",
  ].filter(Boolean).join("  ");

  item.tooltip = [
    `infernoflow — ${status.policyId || "project"} v${status.policyVersion || "?"}`,
    `Capabilities: ${total}  ·  Coverage: ${covered}/${total}`,
    status.hasUnreleased ? "⚠ Unreleased changes in CHANGELOG" : "✔ No unreleased changes",
    bump && bump !== "none"
      ? `📦 Recommended bump: ${bump.toUpperCase()} (${versionRec?.current} → ${versionRec?.next})`
      : "✔ Version up to date",
    "",
    "Click to refresh",
  ].join("\n");

  item.backgroundColor = (allCovered && (!bump || bump === "none" || bump === "patch"))
    ? undefined
    : new vscode.ThemeColor("statusBarItem.warningBackground");

  item.show();
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────

function startAutoRefresh(
  capsProvider: CapabilitiesProvider,
  scenProvider: ScenariosProvider,
  chgProvider: ChangelogProvider,
  agentsProvider: AgentsProvider,
  statusBar: vscode.StatusBarItem
): vscode.Disposable {
  let timer: ReturnType<typeof setInterval> | null = null;

  const schedule = () => {
    if (timer) clearInterval(timer);
    const config = vscode.workspace.getConfiguration("infernoflow");
    const interval = (config.get<number>("autoRefreshInterval") ?? 30) * 1000;
    if (interval > 0) {
      timer = setInterval(() => {
        capsProvider.refresh();
        scenProvider.refresh();
        chgProvider.refresh();
        agentsProvider.refresh();
        const cwd = getCwd();
        const status = cwd ? loadStatus(cwd) : null;
        const versionRec = cwd ? loadVersionRecommendation(cwd) : null;
        updateStatusBar(statusBar, status, versionRec);
      }, interval);
    }
  };

  schedule();

  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("infernoflow")) schedule();
  });

  return {
    dispose: () => {
      if (timer) clearInterval(timer);
      configWatcher.dispose();
    },
  };
}

// ── Source-file save watcher ──────────────────────────────────────────────────

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".cs", ".rb", ".swift"]);
const SKIP_DIRS   = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", "__pycache__"]);

function isSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (!SOURCE_EXTS.has(ext)) return false;
  const parts = filePath.split(/[/\\]/);
  return !parts.some(p => SKIP_DIRS.has(p));
}

function loadCapabilityMap(cwd: string): Record<string, string[]> {
  const p = path.join(cwd, "inferno", "capability-map.json");
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; }
}

function getAffectedCaps(filePath: string, cwd: string, capMap: Record<string, string[]>): string[] {
  const rel = path.relative(cwd, filePath).replace(/\\/g, "/");
  return Object.entries(capMap)
    .filter(([prefix]) => rel.startsWith(prefix.replace(/\\/g, "/")))
    .flatMap(([, caps]) => caps);
}

// ── Activate ──────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const capsProvider    = new CapabilitiesProvider();
  const scenProvider    = new ScenariosProvider();
  const chgProvider     = new ChangelogProvider();
  const agentsProvider  = new AgentsProvider();

  vscode.window.registerTreeDataProvider("infernoflow.capabilities", capsProvider);
  vscode.window.registerTreeDataProvider("infernoflow.scenarios",    scenProvider);
  vscode.window.registerTreeDataProvider("infernoflow.changelog",    chgProvider);
  vscode.window.registerTreeDataProvider("infernoflow.agents",       agentsProvider);

  // Status bar
  const statusBar = createStatusBarItem();
  context.subscriptions.push(statusBar);

  // Initial load
  const doRefresh = () => {
    capsProvider.refresh();
    scenProvider.refresh();
    chgProvider.refresh();
    agentsProvider.refresh();
    const cwd = getCwd();
    const status     = cwd ? loadStatus(cwd) : null;
    const versionRec = cwd ? loadVersionRecommendation(cwd) : null;
    updateStatusBar(statusBar, status, versionRec);

    // Re-apply capability decorations + audit badges on the active editor
    const editor = vscode.window.activeTextEditor;
    if (editor && status?.capabilityDetails) {
      applyCapabilityDecorations(editor, status.capabilityDetails);
    }
    if (editor && cwd) {
      const audit = loadAudit(cwd);
      if (audit?.capabilities) applyAuditDecorations(editor, audit.capabilities);
    }
  };
  doRefresh();

  // Auto-refresh
  const autoRefresh = startAutoRefresh(capsProvider, scenProvider, chgProvider, agentsProvider, statusBar);
  context.subscriptions.push(autoRefresh);

  // File watcher — refresh when inferno/ files change
  const watcher = vscode.workspace.createFileSystemWatcher("**/inferno/**/*.{json,md}");
  watcher.onDidChange(doRefresh);
  watcher.onDidCreate(doRefresh);
  watcher.onDidDelete(doRefresh);
  context.subscriptions.push(watcher);

  // Apply decorations when the active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;
      const cwd = getCwd();
      const status = cwd ? loadStatus(cwd) : null;
      if (status?.capabilityDetails) {
        applyCapabilityDecorations(editor, status.capabilityDetails);
      }
      // Apply audit gutter badges
      const audit = cwd ? loadAudit(cwd) : null;
      if (audit?.capabilities) {
        applyAuditDecorations(editor, audit.capabilities);
      }
    })
  );

  // ── Commands ────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("infernoflow.refresh", doRefresh),

    vscode.commands.registerCommand("infernoflow.check", async () => {
      const terminal = vscode.window.createTerminal("infernoflow check");
      terminal.sendText(`${getCli()} check`);
      terminal.show();
    }),

    vscode.commands.registerCommand("infernoflow.updateContext", async () => {
      const terminal = vscode.window.createTerminal("infernoflow context");
      terminal.sendText(`${getCli()} context`);
      terminal.show();
      // Refresh after a short delay to pick up new CONTEXT.md
      setTimeout(doRefresh, 2000);
    }),

    vscode.commands.registerCommand("infernoflow.openContext", async () => {
      const cwd = getCwd();
      if (!cwd) return;
      const contextPath = path.join(cwd, "inferno", "CONTEXT.md");
      if (!fs.existsSync(contextPath)) {
        vscode.window.showWarningMessage(
          "CONTEXT.md not found. Run infernoflow context first.",
          "Run now"
        ).then((choice) => {
          if (choice === "Run now") {
            vscode.commands.executeCommand("infernoflow.updateContext");
          }
        });
        return;
      }
      vscode.window.showTextDocument(vscode.Uri.file(contextPath));
    }),

    vscode.commands.registerCommand("infernoflow.openCapabilities", async () => {
      const cwd = getCwd();
      if (!cwd) return;
      const capsPath = path.join(cwd, "inferno", "capabilities.json");
      if (fs.existsSync(capsPath)) {
        vscode.window.showTextDocument(vscode.Uri.file(capsPath));
      } else {
        vscode.window.showWarningMessage("capabilities.json not found. Run infernoflow init first.");
      }
    }),

    vscode.commands.registerCommand("infernoflow.changelogUpdate", async () => {
      const terminal = vscode.window.createTerminal("infernoflow changelog");
      terminal.sendText(`${getCli()} changelog update`);
      terminal.show();
      setTimeout(doRefresh, 3000);
    }),

    vscode.commands.registerCommand("infernoflow.diff", async () => {
      const terminal = vscode.window.createTerminal("infernoflow diff");
      terminal.sendText(`${getCli()} diff`);
      terminal.show();
    }),

    // ── New commands ─────────────────────────────────────────────────────────

    vscode.commands.registerCommand("infernoflow.runAgent", async (agentName?: string) => {
      const cwd = getCwd();
      if (!cwd) return;

      let agentId = agentName;
      if (!agentId) {
        // If triggered from command palette, let user pick
        const agentsDir = path.join(cwd, "inferno", "agents");
        if (!fs.existsSync(agentsDir)) {
          vscode.window.showWarningMessage("No agents found. Run infernoflow synthesize first.");
          return;
        }
        const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
        const picked = await vscode.window.showQuickPick(
          files.map((f) => f.replace(".json", "")),
          { placeHolder: "Select agent to run" }
        );
        if (!picked) return;
        agentId = picked;
      }

      const terminal = vscode.window.createTerminal(`infernoflow agent: ${agentId}`);
      terminal.sendText(`${getCli()} agent run ${agentId}`);
      terminal.show();
      setTimeout(doRefresh, 5000);
    }),

    vscode.commands.registerCommand("infernoflow.version", async () => {
      const cwd = getCwd();
      if (!cwd) return;
      const versionRec = loadVersionRecommendation(cwd);
      if (!versionRec) {
        vscode.window.showWarningMessage("Could not determine version recommendation.");
        return;
      }
      if (versionRec.bump === "none") {
        vscode.window.showInformationMessage(
          `infernoflow: version ${versionRec.current} — no bump needed.`
        );
        return;
      }
      const choice = await vscode.window.showInformationMessage(
        `infernoflow recommends a ${(versionRec.bump ?? "patch").toUpperCase()} bump: ${versionRec.current} → ${versionRec.next}`,
        "Apply bump",
        "Cancel"
      );
      if (choice === "Apply bump") {
        const terminal = vscode.window.createTerminal("infernoflow version");
        terminal.sendText(`${getCli()} version --apply`);
        terminal.show();
        setTimeout(doRefresh, 2000);
      }
    }),

    vscode.commands.registerCommand("infernoflow.changelogAi", async () => {
      const terminal = vscode.window.createTerminal("infernoflow changelog ai");
      terminal.sendText(`${getCli()} changelog ai`);
      terminal.show();
      setTimeout(doRefresh, 5000);
    }),

    vscode.commands.registerCommand("infernoflow.dashboard", async () => {
      const terminal = vscode.window.createTerminal("infernoflow dashboard");
      terminal.sendText(`${getCli()} dashboard`);
      terminal.show();
    }),

    vscode.commands.registerCommand("infernoflow.onboard", async () => {
      const terminal = vscode.window.createTerminal("infernoflow onboard");
      terminal.sendText(`${getCli()} onboard`);
      terminal.show();
    }),

    // ── v0.3 commands ─────────────────────────────────────────────────────────

    vscode.commands.registerCommand("infernoflow.openDashboard", () => {
      openDashboardWebview(context);
    }),

    vscode.commands.registerCommand("infernoflow.openGraph", () => {
      openGraphWebview(context);
    }),

    vscode.commands.registerCommand("infernoflow.linkCapability", async () => {
      const cwd = getCwd();
      if (!cwd) { vscode.window.showWarningMessage("No workspace folder open."); return; }
      await quickPickLinkCapability(cwd);
    }),

    vscode.commands.registerCommand("infernoflow.audit", async () => {
      const terminal = vscode.window.createTerminal("infernoflow audit");
      terminal.sendText(`${getCli()} audit`);
      terminal.show();
      // After audit runs, refresh decorations
      setTimeout(doRefresh, 5000);
    }),

    vscode.commands.registerCommand("infernoflow.health", async () => {
      const cwd = getCwd();
      if (!cwd) return;
      const result = runCli(["health", "--json"]);
      try {
        const data = JSON.parse(result.stdout);
        if (data.ok) {
          const score = data.score;
          const grade = data.grade;
          const msg   = `infernoflow health: ${score}/100 (${grade})`;
          if (score >= 80)      vscode.window.showInformationMessage(`✅ ${msg}`);
          else if (score >= 60) vscode.window.showWarningMessage(`⚠ ${msg}`);
          else                  vscode.window.showErrorMessage(`❌ ${msg}`);
        }
      } catch {
        const terminal = vscode.window.createTerminal("infernoflow health");
        terminal.sendText(`${getCli()} health`);
        terminal.show();
      }
    }),

    vscode.commands.registerCommand("infernoflow.scout", async () => {
      const terminal = vscode.window.createTerminal("infernoflow scout");
      terminal.sendText(`${getCli()} scout`);
      terminal.show();
    }),

    // ── AI commands (use vscode.lm → CLI fallback) ──────────────────────────

    vscode.commands.registerCommand("infernoflow.aiSuggest", async () => {
      const cwd = getCwd();
      if (!cwd) return;

      const description = await vscode.window.showInputBox({
        prompt: "What did you just build or change?",
        placeHolder: "e.g. added search filtering to the task list",
      });
      if (!description) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "🔥 infernoflow: syncing contract…", cancellable: false },
        async () => {
          const result = await aiSuggest(description, cwd);
          if (result === "vscodelm") {
            vscode.window.showInformationMessage("✔ Contract synced via Copilot");
          } else if (result === "cli") {
            vscode.window.showInformationMessage("✔ Contract synced via CLI");
          } else {
            vscode.window.showWarningMessage("No AI provider available — set ANTHROPIC_API_KEY or install Copilot");
          }
          doRefresh();
        }
      );
    }),

    vscode.commands.registerCommand("infernoflow.aiReview", async () => {
      const cwd = getCwd();
      if (!cwd) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "🔥 infernoflow: generating review…", cancellable: false },
        async () => {
          // Get git diff
          let diff = "";
          try { diff = execSync("git diff --staged", { cwd, encoding: "utf8" }); } catch {}
          if (!diff.trim()) {
            try { diff = execSync("git diff HEAD~1", { cwd, encoding: "utf8" }); } catch {}
          }
          if (!diff.trim()) {
            vscode.window.showWarningMessage("No staged changes found. Stage some files first.");
            return;
          }

          const infernoDir = path.join(cwd, "inferno");
          const contract   = fs.existsSync(path.join(infernoDir, "contract.json"))
            ? JSON.parse(fs.readFileSync(path.join(infernoDir, "contract.json"), "utf8")) : {};
          const caps = (contract.capabilities || []).join(", ");

          const prompt = [
            `You are a code reviewer analysing capability impact.`,
            `Known capabilities: ${caps}`,
            `Git diff:\n${diff.slice(0, 4000)}`,
            ``,
            `Write a concise (3-5 sentences) review comment explaining:`,
            `1. Which capabilities are affected`,
            `2. Any new capabilities introduced`,
            `3. Any risks or missing test coverage`,
            `Be direct and developer-friendly.`,
          ].join("\n");

          const text = await callVsCodeLM(prompt);
          if (text) {
            // Show in a new document
            const doc = await vscode.workspace.openTextDocument({
              content: `# infernoflow review\n\n${text}\n`,
              language: "markdown",
            });
            vscode.window.showTextDocument(doc);
          } else {
            // Fallback to CLI
            const terminal = vscode.window.createTerminal("infernoflow review");
            terminal.sendText(`${getCli()} review`);
            terminal.show();
          }
        }
      );
    }),

    vscode.commands.registerCommand("infernoflow.snapshotSave", async () => {
      const name = await vscode.window.showInputBox({
        prompt: "Snapshot name",
        placeHolder: "e.g. v1.2-release",
        validateInput: (v) => /^[a-zA-Z0-9._-]+$/.test(v) ? null : "Use letters, digits, dots, dashes, underscores only",
      });
      if (!name) return;
      const result = runCli(["snapshot", "save", name]);
      if (result.status === 0) vscode.window.showInformationMessage(`✓ Snapshot saved: ${name}`);
      else vscode.window.showErrorMessage(`Snapshot failed: ${result.stderr || result.stdout}`);
    }),

    // ── Quick Actions (status bar click) ──────────────────────────────────────

    vscode.commands.registerCommand("infernoflow.quickActions", async () => {
      const cwd = getCwd();
      const action = await vscode.window.showQuickPick([
        { label: "$(sync)               Refresh",                  value: "refresh" },
        { label: "$(pass-filled)        Run check",                value: "check" },
        { label: "$(sparkle)            Sync contract (suggest)",  value: "suggest" },
        { label: "$(comment-discussion) AI Review",                value: "review" },
        { label: "$(tag)                Version recommendation",   value: "version" },
        { label: "$(type-hierarchy)      Capability graph",         value: "graph" },
        { label: "$(browser)            Open dashboard",           value: "dashboard" },
        { label: "$(shield)             Security audit",           value: "audit" },
        { label: "$(heart)              Health score",             value: "health" },
      ], { placeHolder: "infernoflow — choose an action" });

      if (!action) return;
      switch (action.value) {
        case "refresh":   doRefresh(); break;
        case "check":     vscode.commands.executeCommand("infernoflow.check"); break;
        case "suggest":   vscode.commands.executeCommand("infernoflow.aiSuggest"); break;
        case "review":    vscode.commands.executeCommand("infernoflow.aiReview"); break;
        case "version":   vscode.commands.executeCommand("infernoflow.version"); break;
        case "graph":     vscode.commands.executeCommand("infernoflow.openGraph"); break;
        case "dashboard": vscode.commands.executeCommand("infernoflow.openDashboard"); break;
        case "audit":     vscode.commands.executeCommand("infernoflow.audit"); break;
        case "health":    vscode.commands.executeCommand("infernoflow.health"); break;
      }
    }),

    // ── Sync this file (right-click in explorer / editor) ────────────────────

    vscode.commands.registerCommand("infernoflow.syncThisFile", async (uri?: vscode.Uri) => {
      const cwd = getCwd();
      if (!cwd) return;

      const filePath = uri?.fsPath || vscode.window.activeTextEditor?.document.fileName;
      if (!filePath) { vscode.window.showWarningMessage("No file selected."); return; }

      const capMap = loadCapabilityMap(cwd);
      const affected = getAffectedCaps(filePath, cwd, capMap);
      const fileName = path.basename(filePath);

      const desc = affected.length
        ? `changes in ${fileName} (affects: ${affected.slice(0, 3).join(", ")})`
        : `changes in ${fileName}`;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `🔥 infernoflow: syncing ${fileName}…`, cancellable: false },
        async () => {
          const result = await aiSuggest(desc, cwd);
          if (result === "vscodelm") vscode.window.showInformationMessage(`✔ Contract synced for ${fileName}`);
          else if (result === "cli") vscode.window.showInformationMessage(`✔ Contract synced for ${fileName} (CLI)`);
          else vscode.window.showWarningMessage(`No AI provider — run: infernoflow ai setup`);
          doRefresh();
        }
      );
    })
  );

  // ── On-save source file watcher ──────────────────────────────────────────────

  let saveDebounce: ReturnType<typeof setTimeout> | null = null;
  let pendingSaveFiles = new Set<string>();
  let driftWarningShown = false;

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!isSourceFile(doc.fileName)) return;
      const cwd = getCwd();
      if (!cwd) return;

      // Only act if file is mapped in capability-map
      const capMap = loadCapabilityMap(cwd);
      if (!Object.keys(capMap).length) return; // no map yet — skip

      const affected = getAffectedCaps(doc.fileName, cwd, capMap);
      if (!affected.length) return; // file not tracked — skip silently

      pendingSaveFiles.add(doc.fileName);

      // Debounce — batch rapid multi-file saves
      if (saveDebounce) clearTimeout(saveDebounce);
      saveDebounce = setTimeout(async () => {
        const files = Array.from(pendingSaveFiles);
        pendingSaveFiles.clear();

        const fileNames = files.map(f => path.basename(f)).slice(0, 3).join(", ");
        const allCaps   = [...new Set(files.flatMap(f => getAffectedCaps(f, cwd, capMap)))];

        // Update status bar to show sync in progress
        const prevText = statusBar.text;
        statusBar.text = "$(sync~spin) infernoflow: syncing…";

        // Run suggest silently via CLI (no popup)
        const desc = `changes in ${fileNames}`;
        spawnSync(getCli(), ["suggest", desc], {
          cwd, encoding: "utf8", timeout: 30_000,
          env: { ...process.env, NO_COLOR: "1" }, stdio: "ignore",
        });

        // Run check and update status bar accordingly
        const checkResult = spawnSync(getCli(), ["check", "--json"], {
          cwd, encoding: "utf8", timeout: 15_000,
          env: { ...process.env, NO_COLOR: "1" },
        });

        doRefresh(); // refresh tree views and status bar

        try {
          const data = JSON.parse(checkResult.stdout?.trim() || "{}");
          if ((data.status === "error" || data.status === "warning") && !driftWarningShown) {
            driftWarningShown = true;
            const action = await vscode.window.showWarningMessage(
              `infernoflow: contract drift detected in ${allCaps.slice(0, 2).join(", ")}`,
              "View check",
              "Dismiss"
            );
            if (action === "View check") vscode.commands.executeCommand("infernoflow.check");
            setTimeout(() => { driftWarningShown = false; }, 60_000); // re-arm after 1 min
          } else if (data.status === "ok") {
            driftWarningShown = false;
          }
        } catch {}
      }, 3000); // 3s debounce — matches infernoflow watch default
    })
  );
}

export function deactivate(): void {}

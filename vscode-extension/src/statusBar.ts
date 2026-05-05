/**
 * Status bar — ambient session-health summary.
 *
 * Two items, left-aligned:
 *   1. Health summary  →  click opens the sidebar
 *      `🔥 B 65 · ⚠3 · ✓2 · ❌1`
 *   2. Switch button    →  click runs `infernoflow.switch`
 *      `📋 Switch`
 *
 * Updates on file change (via ampIO.onChange) — no polling.
 */

import * as vscode from "vscode";
import { ampIO, MemorySummary } from "./amp";

const GRADE_COLORS: Record<string, string> = {
  A: "#4CAF50",
  B: "#8BC34A",
  C: "#FF9800",
  D: "#FF5722",
  F: "#F44336",
};

export class InfernoStatusBar {
  private main: vscode.StatusBarItem;
  private switchBtn: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.main      = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.switchBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);

    this.main.command      = "infernoflow.openPanel";
    this.switchBtn.command = "infernoflow.switch";
  }

  attach(): void {
    this.update();
    this.disposables.push(ampIO.onChange(() => this.update()));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.main.dispose();
    this.switchBtn.dispose();
  }

  private update(): void {
    const cfg = vscode.workspace.getConfiguration("infernoflow");
    if (!cfg.get<boolean>("showStatusBar", true)) {
      this.main.hide();
      this.switchBtn.hide();
      return;
    }

    if (!ampIO.isAttached()) {
      this.main.hide();
      this.switchBtn.hide();
      return;
    }

    if (!ampIO.isInitialised()) {
      this.main.text    = "$(flame) Init";
      this.main.tooltip = "Click to open a terminal — run: infernoflow init";
      this.main.color   = undefined;
      this.main.command = "workbench.action.terminal.new";
      this.main.show();
      this.switchBtn.hide();
      return;
    }

    const s = ampIO.summary();
    this.main.text = this.formatSummary(s);
    this.main.color = GRADE_COLORS[s.health.grade];
    this.main.tooltip = new vscode.MarkdownString(
      `**infernoflow session memory**  \n` +
      `Health: **${s.health.grade}** (${s.health.score}/100)  \n` +
      `${s.total} entries · ${s.gotchas} gotchas · ${s.decisions} decisions · ${s.attempts} attempts\n\n` +
      `Click to open the Session Memory panel.`,
    );
    this.main.command = "infernoflow.openPanel";
    this.main.show();

    this.switchBtn.text    = "$(arrow-swap) Switch";
    this.switchBtn.tooltip = "Generate a handoff for the next AI agent (and copy to clipboard)";
    this.switchBtn.show();
  }

  private formatSummary(s: MemorySummary): string {
    return `$(flame) ${s.health.grade} ${s.health.score}` +
           ` · $(warning) ${s.gotchas}` +
           ` · $(check) ${s.decisions}` +
           ` · $(error) ${s.attempts}`;
  }
}

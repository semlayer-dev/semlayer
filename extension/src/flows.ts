/**
 * The one-shot editor-tab panels: scope, settings, grants and drift.
 *
 * Each is a webview that renders once, sends a message when the user decides
 * something, and closes. They share `openPanel` because the differences
 * between them are the HTML and the message handler, not the plumbing.
 */
import * as vscode from 'vscode';
import { run } from './cli';
import {
  renderScope, renderSettings, renderGrants, renderDrift,
  Settings, DEFAULT_SETTINGS, Probe, Drift,
} from './views';

type Handler = (msg: { type: string; state?: Settings }, panel: vscode.WebviewPanel) => void;

function openPanel(id: string, title: string, html: string, onMessage: Handler): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    id, title, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = html;
  panel.webview.onDidReceiveMessage((m) => onMessage(m, panel));
  return panel;
}

/** Session settings. Not persisted: they describe one run, not a preference. */
let settings: Settings = { ...DEFAULT_SETTINGS };

export function currentSettings(): Settings { return settings; }
export function resetSettings(): void { settings = { ...DEFAULT_SETTINGS }; }

/**
 * `semlayer probe --json`: what evidence this warehouse offers, and what
 * accuracy follows from it. Returns null when probe cannot read the source,
 * which is a normal outcome for a bad connection string rather than a crash.
 */
export async function probe(source: string, out: vscode.OutputChannel): Promise<Probe | null> {
  try {
    const { stdout, stderr, code } = await run(['probe', source, '--json'], { timeoutMs: 180_000 });
    if (code !== 0 || !stdout.trim().startsWith('{')) {
      out.appendLine(stderr || stdout);
      return null;
    }
    return JSON.parse(stdout) as Probe;
  } catch (e) {
    out.appendLine(`probe: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** The screen that shows the bill before anything is spent. */
export function showScope(p: Probe, source: string, onCreate: () => void): void {
  const panel = openPanel('semlayer.scope', `Scope · ${source}`,
    renderScope(p, source, settings), (m, pnl) => {
      if (m.type === 'create') { pnl.dispose(); onCreate(); }
      if (m.type === 'settings') { pnl.dispose(); showSettings(source, onCreate); }
    });
  panel.reveal();
}

/** Every inference flag that exists, as a form. Reused by Create and Day 2. */
export function showSettings(source: string, onCreate: () => void): void {
  openPanel('semlayer.settings', 'semlayer settings',
    renderSettings(settings, source), (m, pnl) => {
      if (m.type === 'settings' && m.state) { settings = { ...settings, ...m.state }; }
      if (m.type === 'create') { pnl.dispose(); onCreate(); }
      if (m.type === 'close') { pnl.dispose(); }
    });
}

/**
 * `semlayer init` renders a different thing per warehouse family: SQL for
 * Snowflake and Postgres, gcloud IAM commands for BigQuery, and it refuses
 * DuckDB because a file has no grants. The view handles all four.
 */
export async function showGrants(source: string, out: vscode.OutputChannel): Promise<void> {
  const family = source.startsWith('duckdb') ? 'duckdb'
    : source.startsWith('bigquery') ? 'bigquery'
    : source.startsWith('snowflake') ? 'snowflake'
    : 'postgres';

  let script: string | null = null;
  if (family !== 'duckdb') {
    const { stdout, stderr, code } = await run(['init', family], { timeoutMs: 30_000 });
    if (code === 0 && stdout.trim()) { script = stdout; } else { out.appendLine(stderr); }
  }

  openPanel('semlayer.grants', 'Minimal read-only access',
    renderGrants(family, script), async (m, pnl) => {
      if (m.type === 'copy' && script) {
        await vscode.env.clipboard.writeText(script);
        vscode.window.showInformationMessage('Copied.');
      }
      if (m.type === 'save' && script) {
        const target = await vscode.window.showSaveDialog({
          saveLabel: 'Save', defaultUri: vscode.Uri.file('grants.sql') });
        if (target) {
          await vscode.workspace.fs.writeFile(target, Buffer.from(script, 'utf8'));
          await vscode.window.showTextDocument(target);
        }
      }
      if (m.type === 'close') { pnl.dispose(); }
    });
}

/** What moved in the warehouse since the layer was built. */
export function showDrift(d: Drift, doc: string, onReinfer: (tables: string[]) => void): void {
  openPanel('semlayer.drift', `Drift · ${doc}`, renderDrift(d, doc), (m, pnl) => {
    if (m.type === 'reinfer') { pnl.dispose(); onReinfer(d.needs_inference); }
    if (m.type === 'close') { pnl.dispose(); }
  });
}

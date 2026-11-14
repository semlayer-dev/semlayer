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
  renderGrants, renderDrift,
  Settings, DEFAULT_SETTINGS, Probe, Drift, Connection,
} from './views';

type Msg = { type: string; state?: Settings; source?: string; family?: string };
type Handler = (msg: Msg, panel: vscode.WebviewPanel) => void;

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
/** The sidebar's Create screen edits the same session settings Day 2 does. */
export function setSettings(s: Settings): void { settings = { ...settings, ...s }; }

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

/**
 * What this machine can already reach.
 *
 * Returns an empty list rather than throwing on an engine that has no
 * `discover` verb -- it landed after 0.7.0b3, so a user on the published
 * version has an engine without it, and the connect screen must still open
 * and still offer the sample and a typed connection. An absent verb is a
 * shorter list, not a broken screen.
 */
export async function discover(out: vscode.OutputChannel): Promise<Connection[]> {
  // The cwd matters here -- one of the sources discover reads is "DuckDB files
  // in the working directory" -- and `run` now defaults it to the folder the
  // user opened, for this call and every other one.
  try {
    const { stdout, code } = await run(['discover', '--json'], { timeoutMs: 60_000 });
    if (code !== 0 || !stdout.trim().startsWith('[')) {
      out.appendLine(`discover: this engine has no \`discover\` verb; skipping the list`);
      return [];
    }
    return JSON.parse(stdout) as Connection[];
  } catch (e) {
    out.appendLine(`discover: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * The grant scripts the connect screen shows under its selection.
 *
 * All three are fetched up front because the screen switches between them
 * without a round trip. They are local renders of a template -- no warehouse
 * is contacted -- so three calls cost nothing worth optimising. A family whose
 * call fails is simply absent, and the screen hides that section.
 */
export async function grantScripts(out: vscode.OutputChannel): Promise<Record<string, string>> {
  const families = ['snowflake', 'bigquery', 'postgres'];
  const got: Record<string, string> = {};
  await Promise.all(families.map(async (f) => {
    try {
      const { stdout, code } = await run(['init', f], { timeoutMs: 30_000 });
      if (code === 0 && stdout.trim()) { got[f] = stdout.trimEnd(); }
    } catch (e) {
      out.appendLine(`init ${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }));
  return got;
}

/**
 * `semlayer init` renders a different thing per warehouse family: SQL for
 * Snowflake and Postgres, gcloud IAM commands for BigQuery, and it refuses
 * DuckDB because a file has no grants. The view handles all four.
 */
export function familyOf(source: string): string {
  return source.startsWith('duckdb') ? 'duckdb'
    : source.startsWith('bigquery') ? 'bigquery'
    : source.startsWith('snowflake') ? 'snowflake'
    : 'postgres';
}

export async function showGrants(source: string, out: vscode.OutputChannel): Promise<void> {
  // A bare family name is accepted so the connect screen can ask for grants
  // before any connection exists -- which is exactly when they are needed.
  const family = ['duckdb', 'bigquery', 'snowflake', 'postgres'].includes(source)
    ? source : familyOf(source);

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

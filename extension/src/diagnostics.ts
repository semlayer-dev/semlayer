/**
 * SQL diagnostics from `semlayer lint --json`.
 *
 * This is the one thing the extension does that a terminal cannot: a finding
 * is only useful at the moment you are writing the line.
 *
 * Positions come from the ENGINE now. They used to be reconstructed here --
 * find the statement by the SQL the engine echoed back, then search it for
 * the table or column identifier -- and the README had to admit the
 * underlines were "close, not exact". They were also wrong in a way nobody
 * would report: two identical statements both underlined the first one.
 *
 * `lint --json` reports `line`, `col`, `start` and `end` per finding, taken
 * from the parser rather than from a text search, and `offset` per
 * statement. We send the document's own text, so those offsets index
 * straight into the document.
 */
import * as vscode from 'vscode';
import { run } from './cli';
import * as layers from './layer';

/** Held back while the user is mid-keystroke: half-written SQL never parses. */
const WHILE_TYPING_SUPPRESSED = new Set(['parse_error']);

const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

/** One finding from `semlayer lint --json`. */
export interface Finding {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  table: string | null;
  column: string | null;
  fix: string | null;
  /** Offsets into the text that was linted. Absent for a parse failure. */
  start?: number | null;
  end?: number | null;
}

export interface StatementResult {
  sql: string;
  /** Where this statement begins in the linted text. */
  offset?: number;
  findings: Finding[];
}

function toRange(doc: vscode.TextDocument, stmt: StatementResult,
                 f: Finding): vscode.Range {
  if (typeof f.start === 'number' && typeof f.end === 'number') {
    // `end` is the last character of the identifier, not one past it.
    return new vscode.Range(doc.positionAt(f.start), doc.positionAt(f.end + 1));
  }
  // No anchor -- a parse failure, which is about the statement rather than
  // anything in it. Underline its first line rather than inventing a range.
  const start = stmt.offset ?? 0;
  const newline = stmt.sql.search(/\r?\n/);
  const length = newline < 0 ? stmt.sql.length : newline;
  return new vscode.Range(doc.positionAt(start), doc.positionAt(start + length));
}

export class Linter {
  private readonly collection = vscode.languages.createDiagnosticCollection('semlayer');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inflight = new Map<string, vscode.CancellationTokenSource>();

  constructor(private readonly out: vscode.OutputChannel) {}

  dispose(): void {
    this.collection.dispose();
    this.timers.forEach(clearTimeout);
    this.inflight.forEach((c) => c.cancel());
  }

  clear(doc: vscode.TextDocument): void { this.collection.delete(doc.uri); }

  /** Save and open: every rule. */
  settled(doc: vscode.TextDocument): void { void this.lint(doc, false); }

  /** Keystroke: debounced, and incomplete syntax stays quiet. */
  typing(doc: vscode.TextDocument): void {
    const cfg = vscode.workspace.getConfiguration('semlayer');
    if (!cfg.get<boolean>('lint.onType', true)) { return; }
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(
      () => void this.lint(doc, true),
      cfg.get<number>('lint.debounceMs', 500)));
  }

  private async lint(doc: vscode.TextDocument, whileTyping: boolean): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('semlayer');
    if (!cfg.get<boolean>('lint.enable', true) || doc.languageId !== 'sql') { return; }

    const layer = await layers.active();
    if (!layer) { this.collection.delete(doc.uri); return; }

    const key = doc.uri.toString();
    this.inflight.get(key)?.cancel();
    const cancel = new vscode.CancellationTokenSource();
    this.inflight.set(key, cancel);

    const text = doc.getText();
    if (!text.trim()) { this.collection.delete(doc.uri); return; }

    let parsed: StatementResult[];
    try {
      const { stdout, stderr } = await run(
        ['lint', layer.uri.fsPath, '-', '--json',
         '--dialect', cfg.get<string>('dialect', 'duckdb')],
        { stdin: text, timeoutMs: 15_000, token: cancel.token });
      if (!stdout.trim()) {
        if (stderr.trim()) { this.out.appendLine(`lint: ${stderr.trim()}`); }
        return;
      }
      parsed = JSON.parse(stdout) as StatementResult[];
    } catch (e) {
      if (e instanceof vscode.CancellationError) { return; }
      this.out.appendLine(`lint failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    } finally {
      if (this.inflight.get(key) === cancel) { this.inflight.delete(key); }
    }

    const diagnostics: vscode.Diagnostic[] = [];

    parsed.forEach((stmt) => {
      for (const f of stmt.findings) {
        if (whileTyping && WHILE_TYPING_SUPPRESSED.has(f.rule)) { continue; }
        const d = new vscode.Diagnostic(
          toRange(doc, stmt, f),
          f.fix ? `${f.message}\n\nfix: ${f.fix}` : f.message,
          SEVERITY[f.severity] ?? vscode.DiagnosticSeverity.Warning);
        d.source = 'semlayer';
        d.code = f.rule;
        diagnostics.push(d);
      }
    });

    this.collection.set(doc.uri, diagnostics);
  }
}

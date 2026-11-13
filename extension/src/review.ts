/**
 * The review queue as a screen, not a prompt loop.
 *
 * `semlayer review` on its own is an interactive terminal flow, and the first
 * version of this command simply opened a terminal and ran it. That works and
 * is not what was designed: a queue needs width, the consequences of a verdict
 * should be visible BEFORE the click, and one question can cover hundreds of
 * objects. So this reads `review --list --json`, renders it, and writes
 * verdicts back with `review --answer`.
 *
 * An editor tab rather than a sidebar view, for the same reason: at 400px
 * there is no room for a claim, its evidence, both consequences and its
 * objects at once.
 */
import * as vscode from 'vscode';
import { run } from './cli';
import { renderReview, sortQuestions, Queue } from './views';

type Msg =
  | { type: 'select'; index: number }
  | { type: 'answer'; key: string; verdict: 'accept' | 'reject' }
  | { type: 'bulk'; keys: string[] }
  | { type: 'skip' };

export class ReviewPanel {
  private static current: ReviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private queue: Queue | null = null;
  private selected = 0;
  private busy = false;

  static async show(doc: vscode.Uri, out: vscode.OutputChannel,
                    onChange?: () => void): Promise<void> {
    if (ReviewPanel.current) {
      ReviewPanel.current.panel.reveal();
      await ReviewPanel.current.load();
      return;
    }
    ReviewPanel.current = new ReviewPanel(doc, out, onChange);
    await ReviewPanel.current.load();
  }

  private constructor(private readonly doc: vscode.Uri,
                      private readonly out: vscode.OutputChannel,
                      private readonly onChange?: () => void) {
    this.panel = vscode.window.createWebviewPanel(
      'semlayer.review', `Review · ${doc.path.split('/').pop()}`,
      vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });

    this.panel.onDidDispose(() => { ReviewPanel.current = undefined; });
    this.panel.webview.onDidReceiveMessage(async (m: Msg) => {
      switch (m.type) {
        case 'select':
          this.selected = m.index;
          this.render();
          break;
        case 'answer':
          await this.answer([`${m.key}=${m.verdict}`]);
          break;
        case 'bulk':
          if (m.keys.length) { await this.answer(m.keys.map((k) => `${k}=accept`)); }
          break;
        case 'skip':
          this.selected = Math.min(this.selected + 1, (this.queue?.questions.length ?? 1) - 1);
          this.render();
          break;
      }
    });
  }

  private async load(): Promise<void> {
    try {
      const { stdout, stderr } = await run(
        ['review', this.doc.fsPath, '--list', '--json'], { timeoutMs: 60_000 });
      if (!stdout.trim()) { throw new Error(stderr || 'no output'); }
      const q = JSON.parse(stdout) as Queue;
      this.queue = { ...q, questions: sortQuestions(q.questions) };
      this.selected = 0;
    } catch (e) {
      this.out.appendLine(`review: ${e instanceof Error ? e.message : String(e)}`);
      this.queue = null;
    }
    this.render();
  }

  /** Record verdicts, then reload: the queue shrinks and the numbering shifts. */
  private async answer(pairs: string[]): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    this.render();
    try {
      const { code, stdout, stderr } = await run(
        ['review', this.doc.fsPath, '--answer', pairs.join(',')], { timeoutMs: 120_000 });
      this.out.appendLine(stdout || stderr);
      if (code !== 0) {
        vscode.window.showErrorMessage('semlayer: the verdict was not recorded.', 'Show output')
          .then((a) => { if (a) { this.out.show(); } });
      } else {
        this.onChange?.();
      }
    } finally {
      this.busy = false;
    }
    await this.load();
  }

  private render(): void {
    this.panel.webview.html = renderReview(this.queue, this.selected, this.busy);
  }
}

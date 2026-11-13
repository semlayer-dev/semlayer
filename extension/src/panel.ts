/**
 * The sidebar view.
 *
 * Three states, and which one you see is decided by what exists rather than by
 * where you are in a wizard:
 *
 *   no CLI     -> install it, and nothing else
 *   no layer   -> the walkthrough: connect, create, query
 *   a layer    -> the resting state: what is served, what drifted, what is open
 *
 * The walkthrough removes itself. A numbered "step 1 of 3" that survives to day
 * 30 is a wizard nobody can dismiss.
 *
 * All HTML lives in `views.ts`, which imports nothing from vscode so that every
 * state can be rendered and screenshotted outside the editor.
 */
import { spawn } from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';
import * as layers from './layer';
import * as mcp from './mcp';
import { run, setRoute } from './cli';
import * as engine from './engine';
import { renderPanel, driftLine, PanelState, EngineOffer, Drift } from './views';

/**
 * Drift costs a warehouse round trip, so it is not fetched on every refresh.
 * Cached for the session, recomputed when the user asks or a run finishes.
 */
let cachedDrift: { line: string | null; at: number } | undefined;

/** Whether this engine has `semlayer demo`. Undefined until asked once. */
let canDemo: boolean | undefined;
const DRIFT_TTL_MS = 10 * 60_000;

export function invalidateDrift(): void { cachedDrift = undefined; }

/** Forget what we learned about the engine: it may have been replaced. */
export function invalidateEngine(): void { canDemo = undefined; }

/**
 * `semlayer drift --json` prints the plain sentence "no drift detected" rather
 * than JSON when there is nothing to report, so this has to tolerate that
 * instead of treating calm as a parse failure.
 */
export async function readDrift(doc: vscode.Uri, source: string): Promise<Drift | null> {
  const { stdout } = await run(['drift', doc.fsPath, source, '--json'], { timeoutMs: 120_000 });
  const text = stdout.trim();
  if (!text.startsWith('{')) { return null; }
  return JSON.parse(text) as Drift;
}

/** Does this command answer? One short call, nothing cached, nothing fetched. */
async function probeCommand(argv: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { shell: false });
    const done = (ok: boolean) => { clearTimeout(timer); child.kill(); resolve(ok); };
    const timer = setTimeout(() => done(false), 10_000);
    child.on('error', () => done(false));
    child.on('close', (code) => done(code === 0));
    child.stdout?.resume();
    child.stderr?.resume();
  });
}

export class Panel implements vscode.WebviewViewProvider {
  public static readonly viewId = 'semlayer.panel';
  private view?: vscode.WebviewView;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    view.webview.onDidReceiveMessage((m: { command?: string }) => {
      if (typeof m?.command === 'string') { void vscode.commands.executeCommand(m.command); }
    });
    void this.refresh();
  }

  /**
   * How this machine can run the engine, and what to offer if it cannot.
   *
   * Recomputed on every refresh rather than cached: a user who installs uv
   * while the panel is open should see it the next time it redraws, without
   * reloading the window or configuring anything.
   */
  private async engineOffer(): Promise<
      { cli: string | null; offer?: EngineOffer; viaUvx?: boolean }> {
    const configured = vscode.workspace.getConfiguration('semlayer')
      .get<string>('cliPath') ?? 'semlayer';

    // The probe runs the argv it is GIVEN, which is the launcher's own version
    // check, not the route. Routing it through `version()` meant running the
    // whole uvx invocation -- a multi-minute first fetch behind a ten-second
    // timeout, which is why a machine with uvx on its PATH was told it had no
    // engine.
    const route = await engine.resolve(configured, {
      works: (argv) => probeCommand(argv),
    }, os.homedir());

    if (route.kind === 'install') {
      setRoute(undefined);
      const [first, ...rest] = engine.installers();
      return {
        cli: null,
        offer: {
          kind: 'install',
          label: first.label, command: first.command, note: first.note,
          alternatives: rest,
        },
      };
    }

    // `resolve` already proved this route answers. Asking `version()` again
    // re-runs the WHOLE command behind the same ten-second timeout -- which on
    // a cold uvx is a multi-minute fetch -- and then throws that answer away.
    // That is how a machine with a working uvx ended up on the no-engine
    // panel with no install offer on it either: the route resolved, the
    // second check timed out, and neither branch had anything to show.
    setRoute(route.argv);
    return { cli: route.argv.join(' '), viaUvx: route.kind === 'uvx' };
  }

  async refresh(): Promise<void> {
    if (!this.view) { return; }
    const engineState = await this.engineOffer();
    const [layer, all] = await Promise.all([layers.active(), layers.discover(5)]);
    const cli = engineState.cli;
    const clients = await Promise.all(mcp.clients().map(async (c) => (
      { label: c.label, state: await mcp.stateOf(c) })));

    // Does this engine have `semlayer demo`? It landed after 0.7.0b2, so the
    // published version does not, and offering a sample that is not there is
    // the dead end this replaced. Asked once per session, from --help, which
    // is already cached by the time we get here.
    if (cli && canDemo === undefined) {
      const { stdout } = await run(['--help'], { timeoutMs: 20_000 })
        .catch(() => ({ stdout: '' }));
      canDemo = /^\s+demo\b/m.test(stdout) || /\bdemo\b/.test(stdout.split('\n')[1] ?? '');
    }

    const fresh = cachedDrift && Date.now() - cachedDrift.at < DRIFT_TTL_MS;
    const state: PanelState = {
      cli,
      offer: engineState.offer,
      viaUvx: engineState.viaUvx ?? false,
      layer: layer ? { name: layer.name, tables: layer.tables } : undefined,
      others: Math.max(0, all.length - 1),
      clients,
      drift: layer && fresh ? cachedDrift!.line : null,
      canDemo: canDemo === true,
      // "Try a sample warehouse" needs a `semlayer demo` command that does not
      // exist: the fixtures live in the source tree, which a marketplace
      // install has no copy of. Offering the button would be offering nothing.
    };
    this.view.webview.html = renderPanel(state);
  }

  /** Called after a drift check so the sidebar can carry its one-line summary. */
  setDrift(d: Drift | null): void {
    cachedDrift = { line: driftLine(d), at: Date.now() };
    void this.refresh();
  }
}

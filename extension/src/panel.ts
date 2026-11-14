/**
 * The sidebar view.
 *
 * Four states, and which one you see is decided by what exists rather than by
 * where you are in a wizard:
 *
 *   no CLI     -> install it, and nothing else
 *   no layer   -> the walkthrough: connect, create, query
 *   connecting -> step one: which warehouse, out of the ones found here
 *   a layer    -> the resting state: what is served, what drifted, what is open
 *
 * Connecting is the one state entered deliberately rather than deduced, which
 * is why it overrides the other three while it is set.
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
import * as flows from './flows';
import {
  renderPanel, driftLine, plural, screenFor, badgeFor,
  PanelState, EngineOffer, Drift, ConnectState, Connection, Steps, Probe, Settings,
  Screen,
} from './views';

/**
 * Drift costs a warehouse round trip, so it is not fetched on every refresh.
 * Cached for the session, recomputed when the user asks or a run finishes.
 */
let cachedDrift: { line: string | null; at: number } | undefined;

/** Whether this engine has `semlayer demo`. Undefined until asked once. */
let canDemo: boolean | undefined;
const DRIFT_TTL_MS = 10 * 60_000;

/**
 * The connect screen's two inputs, cached because the sidebar now draws that
 * screen on every refresh while no layer exists -- and a refresh happens on
 * every config change and every YAML file event.
 *
 * The grant scripts are templates `semlayer init` renders from nothing, so
 * they are fetched once and kept. The connection list can change under us --
 * someone adds a profile, or writes the sample -- so it expires, and clicking
 * step one drops it outright.
 */
let grantsCache: Record<string, string> | undefined;
let connsCache: { v: Connection[]; at: number } | undefined;
const CONNS_TTL_MS = 60_000;

/**
 * How many questions the review queue holds, per layer file.
 *
 * `review --list --json` reads the document and groups the undecided claims;
 * it touches no warehouse, but it is still a process start on every sidebar
 * refresh, and a refresh happens on every YAML event. So: cached per path,
 * dropped when a verdict is recorded or the layer is rebuilt.
 */
let findingsCache: { path: string; n: number; at: number } | undefined;
const FINDINGS_TTL_MS = 5 * 60_000;

/**
 * How far this machine has got: no uv, uv, or a usable engine.
 *
 * Exported so the commands outside the panel ask the panel's own question
 * rather than their own. `recheck` and the install watcher each had a private
 * yes/no ("did `version()` answer?"), which cannot see the middle state and
 * reported it as failure.
 */
export async function currentRoute(): Promise<engine.Route> {
  const configured = vscode.workspace.getConfiguration('semlayer')
    .get<string>('cliPath') ?? 'semlayer';
  return engine.resolve(
    configured, { works: (argv) => probeCommand(argv) }, os.homedir());
}

export async function currentStage(): Promise<engine.Stage> {
  return engine.stage(await currentRoute());
}

export function invalidateDrift(): void { cachedDrift = undefined; }
export function invalidateConnections(): void { connsCache = undefined; }
export function invalidateFindings(): void { findingsCache = undefined; }

/**
 * The open-question count, or null when it cannot be had.
 *
 * Null rather than zero on failure, and the difference matters: zero means
 * "nothing left to review", which is a thing to show, and null means we do
 * not know, which is a thing to stay quiet about. A badge reading 0 on a
 * layer with 20 open questions would be worse than no badge.
 */
async function findings(path: string): Promise<number | null> {
  const fresh = findingsCache && findingsCache.path === path
    && Date.now() - findingsCache.at < FINDINGS_TTL_MS;
  if (fresh) { return findingsCache!.n; }
  try {
    const { stdout, code } = await run(['review', path, '--list', '--json'],
                                       { timeoutMs: 60_000 });
    if (code !== 0 || !stdout.trim().startsWith('{')) { return null; }
    const q = JSON.parse(stdout) as { questions?: unknown[] };
    const n = Array.isArray(q.questions) ? q.questions.length : 0;
    findingsCache = { path, n, at: Date.now() };
    return n;
  } catch {
    return null;
  }
}

/** Forget what we learned about the engine: it may have been replaced. */
export function invalidateEngine(): void { canDemo = undefined; }

/**
 * Whether the engine has `semlayer demo`, asked at most once per session.
 *
 * A failed call leaves the question OPEN rather than answering no: the first
 * version cached a timed-out `--help` as "no demo command" and hid the sample
 * warehouse for the rest of the session, on exactly the machine that had
 * nothing else to point at.
 */
export async function hasDemo(): Promise<boolean> {
  if (canDemo === undefined) {
    const { stdout } = await run(['--help'], { timeoutMs: 120_000 })
      .catch(() => ({ stdout: '' }));
    if (stdout.trim()) {
      canDemo = /^\s+demo\b/m.test(stdout) || /\bdemo\b/.test(stdout.split('\n')[1] ?? '');
    }
  }
  return canDemo === true;
}

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

/**
 * "built 4 weeks ago", from the file's own mtime.
 *
 * The document records no build time of its own, so this is the file's, which
 * is the same thing until someone edits it by hand. Empty rather than a guess
 * when the file cannot be stat'ed.
 */
async function builtAgo(uri: vscode.Uri): Promise<string> {
  let mtime: number;
  try {
    mtime = (await vscode.workspace.fs.stat(uri)).mtime;
  } catch {
    return '';
  }
  const days = Math.floor((Date.now() - mtime) / 86_400_000);
  if (days < 1) { return 'built today'; }
  if (days < 7) { return `built ${plural(days, 'day')} ago`; }
  if (days < 60) { return `built ${plural(Math.floor(days / 7), 'week')} ago`; }
  return `built ${plural(Math.floor(days / 30), 'month')} ago`;
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

/** What the sidebar's screens post back. Anything else is a command name. */
export interface PanelMsg { type: string; source?: string; state?: Settings }

export class Panel implements vscode.WebviewViewProvider {
  public static readonly viewId = 'semlayer.panel';
  private view?: vscode.WebviewView;

  /**
   * Where the user asked to be, or undefined for "wherever makes sense".
   *
   * ONE value, deliberately. This was three independent flags and every
   * navigation had to remember to clear the other two; the ones that forgot
   * did nothing at all when clicked. `screenFor` resolves it.
   */
  private requested?: Screen;

  /** The warehouse picked on step one, before anything has been built from it. */
  private chosen?: string;

  /** The probe behind step two. Present or not; it does not decide the screen. */
  private scope?: { probe: Probe; source: string; running?: boolean; expanded?: boolean };

  /**
   * Who handles the connect screen's choices.
   *
   * The panel renders step one but does not act on it: probing a warehouse and
   * showing the bill belong to the command layer, and wiring them in here
   * would make this file import the whole flow.
   */
  public onMessage?: (m: PanelMsg) => void;

  constructor(private readonly ctx: vscode.ExtensionContext,
              private readonly out: vscode.OutputChannel) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    view.webview.onDidReceiveMessage((m: { command?: string; type?: string; state?: Settings }) => {
      if (typeof m?.command === 'string') { void vscode.commands.executeCommand(m.command); }
      if (typeof m?.type === 'string') { this.onMessage?.(m as PanelMsg); }
    });
    void this.refresh();
  }

  /**
   * Go to step one, re-reading what this machine can see.
   *
   * The cache is dropped rather than waited out: the commonest reason to come
   * back here is that something changed -- a profile added, credentials fixed
   * -- and showing a minute-old list would answer the wrong question.
   */
  async showConnect(): Promise<void> {
    this.requested = 'connect';
    invalidateConnections();
    await this.refresh();
    this.view?.show?.(true);
  }

  /** Leave step one, letting the sidebar settle wherever it should. */
  async leaveConnect(): Promise<void> {
    if (this.requested !== 'connect') { return; }
    this.requested = undefined;
    await this.refresh();
  }

  /** Remember what was picked, so the checklist can tick step one. */
  noteSource(source: string): void { this.chosen = source; }

  /** Step two: the bill, in the same pane step one was in. */
  async showScope(probe: Probe, source: string, expanded = false): Promise<void> {
    this.chosen = source;
    this.scope = { probe, source, expanded };
    this.requested = 'scope';
    await this.refresh();
    this.view?.show?.(true);
  }

  /** The run is going; keep step two on screen and show that it is. */
  async setRunning(running: boolean): Promise<void> {
    if (!this.scope) { return; }
    this.scope = { ...this.scope, running };
    await this.refresh();
  }

  /** Done with step two: drop the probe and let the sidebar settle. */
  async leaveScope(): Promise<void> {
    if (!this.scope) { return; }
    this.scope = undefined;
    if (this.requested === 'scope') { this.requested = undefined; }
    await this.refresh();
  }

  /** Step three: which clients can reach the layer. */
  async showServe(): Promise<void> {
    this.requested = 'serve';
    await this.refresh();
    this.view?.show?.(true);
  }

  /**
   * Back to the resting state, which is the only destination the checklist
   * cannot name. Every step screen offers it once a layer exists.
   */
  async goHome(): Promise<void> {
    this.requested = 'home';
    this.scope = undefined;
    await this.refresh();
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
      // `route.via` IS the answer. This used to discard it and always offer
      // `installers()[0]` -- "Install uv" -- so a user who had just installed
      // uv pressed Check again and was offered uv a second time, and a third.
      // The resolver had said "Install the engine" every time and nothing
      // read it. It stayed hidden while the uvx route outranked this branch;
      // the moment the install was preferred over uvx it became the first
      // thing a new user sees.
      const via = route.via;
      // Narrowed: inside this branch there is no engine, so `stage` is one of
      // the two install stages and the view's type says so.
      const stage = engine.stage(route) === 'uv' ? 'uv' as const : 'nothing' as const;
      const rest = engine.installers().slice(1);
      return {
        cli: null,
        offer: {
          kind: 'install',
          label: via.label, command: via.command, note: via.note,
          stage,
          // With uv already here, "install uv another way" is not an
          // alternative to anything. The Python routes still are: they are
          // other ways to get the ENGINE.
          alternatives: stage === 'uv'
            ? rest.filter((a) => a.command.includes('semlayer'))
            : rest,
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
    //
    // A failed call leaves this UNDECIDED rather than false. The first version
    // assigned the regex result unconditionally, so a `--help` that timed out
    // -- which is what a cold engine does -- cached "no demo command" for the
    // whole session and hid the sample-warehouse button permanently, on the
    // machine that needed it most. An unanswered question is not a no.
    if (cli) { await hasDemo(); }

    const open = layer && cli ? await findings(layer.uri.fsPath) : null;
    // The badge on the activity-bar icon: the one place the extension can say
    // "there is something here" while the user is looking at their code. It is
    // the question count, not the undecided-claim count -- 46 claims collapse
    // into 20 questions, and 20 is the number of decisions to make.
    this.view.badge = badgeFor(open);

    const fresh = cachedDrift && Date.now() - cachedDrift.at < DRIFT_TTL_MS;
    const screen = cli
      ? screenFor(this.requested,
                  { hasLayer: layer !== undefined, hasScope: this.scope !== undefined })
      : 'home';
    const driftLine = layer && fresh ? cachedDrift!.line : null;
    const steps = this.steps(layer, clients, screen, driftLine);
    const state: PanelState = {
      cli,
      offer: engineState.offer,
      viaUvx: engineState.viaUvx ?? false,
      layer: layer ? { name: layer.name, tables: layer.tables } : undefined,
      others: Math.max(0, all.length - 1),
      clients,
      drift: driftLine,
      findings: open,
      canDemo: canDemo === true,
      steps,
      // Exactly one of these is set, and which one is decided in one place.
      scope: screen === 'scope'
        // Being on this screen IS step two, whatever is already on disk.
        // Otherwise revisiting Create from a built layer showed the checklist
        // pointing at step three while you stood on step two.
        ? { ...this.scope!, settings: flows.currentSettings(),
            hasLayer: layer !== undefined, steps: { ...steps, step: 2 } }
        : undefined,
      serve: screen === 'serve' ? { layer: layer!.name, clients, steps } : undefined,
      connect: screen === 'connect'
        ? await this.connectState(layer, all, steps, engineState.viaUvx ?? false)
        : undefined,
    };
    this.view.webview.html = renderPanel(state);
  }

  /**
   * Where the user is in the three steps, deduced from what exists.
   *
   * Nothing records progress, and nothing should: a layer on disk means step
   * two happened, whoever did it and whenever. The one thing that cannot be
   * read back is which warehouse was picked before a layer exists, which is
   * why `chosen` is remembered for the length of the session.
   */
  private steps(layer: layers.Layer | undefined,
                clients: { label: string; state: mcp.ClientState }[],
                screen?: Screen, drift?: string | null): Steps {
    const serving = clients.filter((c) => c.state === 'configured').map((c) => c.label);
    return {
      maintain: layer ? {
        label: 'Maintain the layer',
        detail: drift ?? '',
        cmd: 'semlayer.home',
        current: screen === 'home',
      } : undefined,
      step: !layer ? (this.chosen ? 2 : 1) : serving.length ? 4 : 3,
      detail: [
        layer ? layer.name : (this.chosen ?? ''),
        layer && layer.tables !== null ? plural(layer.tables, 'table') : '',
        serving.length ? `serving ${serving.join(', ')}` : '',
      ],
      // Each row opens that step's SCREEN. Pointing them at commands meant
      // step two opened an editor tab and step three a quick-pick, so two of
      // the three rows in a navigation bar did not navigate.
      cmds: ['semlayer.createLayer', 'semlayer.createStep', 'semlayer.serve'],
    };
  }

  private async connectState(layer: layers.Layer | undefined,
                             all: layers.Layer[],
                             steps: Steps, viaUvx: boolean): Promise<ConnectState> {
    if (!grantsCache) { grantsCache = await flows.grantScripts(this.out); }
    if (!connsCache || Date.now() - connsCache.at > CONNS_TTL_MS) {
      connsCache = { v: await flows.discover(this.out), at: Date.now() };
    }
    return {
      conns: connsCache.v,
      layers: await Promise.all(all.map(async (l) => ({
        file: vscode.workspace.asRelativePath(l.uri),
        path: l.uri.fsPath,
        meta: [l.tables === null ? '' : plural(l.tables, 'table'), await builtAgo(l.uri)]
          .filter(Boolean).join(' · '),
      }))),
      canDemo: canDemo === true,
      grants: grantsCache,
      canCancel: layer !== undefined,
      steps,
      viaUvx,
    };
  }

  /** Called after a drift check so the sidebar can carry its one-line summary. */
  setDrift(d: Drift | null): void {
    cachedDrift = { line: driftLine(d), at: Date.now() };
    void this.refresh();
  }
}

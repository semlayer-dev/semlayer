/**
 * semlayer for VS Code and Cursor.
 *
 * The extension is a thin front end over the `semlayer` CLI. It holds no
 * engine, speaks no MCP, and has no runtime npm dependencies: every answer
 * comes from `semlayer <command> --json` run as a subprocess. MCP is how the
 * *agent* reads the layer; this is how the *human* does.
 */
import * as vscode from 'vscode';
import { Linter } from './diagnostics';
import { Panel, readDrift, invalidateDrift, invalidateFindings } from './panel';
import * as flows from './flows';
import { installers as engineInstallers } from './engine';
import { settingsToArgs } from './views';
import { ReviewPanel } from './review';
import { run, version, CliError } from './cli';
import * as layers from './layer';
import * as mcp from './mcp';

let status: vscode.StatusBarItem;

/** How long the "running" state stays up at minimum. See its one use. */
const MIN_RUNNING_MS = 900;

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const out = vscode.window.createOutputChannel('semlayer');
  const linter = new Linter(out);
  const panel = new Panel(ctx, out);

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
  status.command = 'semlayer.selectLayer';
  ctx.subscriptions.push(out, linter, status,
    vscode.window.registerWebviewViewProvider(Panel.viewId, panel));

  const refresh = async () => {
    await panel.refresh();
    await updateStatus();
    await setContexts();
  };

  // --- linting -----------------------------------------------------------
  const lintIfSql = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'sql') { return; }
    linter.settled(doc);
    // Ticks the walkthrough's "Open a SQL file" step. It used to be declared
    // as `onLanguage:sql`, which is an ACTIVATION event, not a walkthrough
    // completion event -- VS Code accepts only onCommand, onSettingChanged,
    // onContext, onExtensionInstalled, onView, onLink and onStepSelected, so
    // the step silently never completed. Nothing warns about this; it is
    // visible only by opening the walkthrough and seeing an unticked step.
    void vscode.commands.executeCommand('setContext', 'semlayer.sawSql', true);
  };
  vscode.workspace.textDocuments.forEach(lintIfSql);
  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lintIfSql),
    vscode.workspace.onDidSaveTextDocument(lintIfSql),
    vscode.workspace.onDidCloseTextDocument((d) => linter.clear(d)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'sql' && e.contentChanges.length) {
        linter.typing(e.document);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('semlayer')) {
        layers.invalidate();
        vscode.workspace.textDocuments.forEach(lintIfSql);
        void refresh();
      }
    }));

  // A layer that changes on disk changes every diagnostic in the workspace.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{yaml,yml}');
  const onLayerChange = () => {
    layers.invalidate();
    // Verdicts are written into the document, so the queue shrinks exactly
    // when the file changes. This is also what makes the badge fall after a
    // review session instead of sitting on a stale number for five minutes.
    invalidateFindings();
    vscode.workspace.textDocuments.forEach(lintIfSql);
    void refresh();
  };
  ctx.subscriptions.push(watcher,
    watcher.onDidCreate(onLayerChange), watcher.onDidChange(onLayerChange),
    watcher.onDidDelete(onLayerChange));

  // --- commands ----------------------------------------------------------
  // The argument is passed through because a command invoked from code can
  // carry one (`semlayer.createStep` takes { settings: true }); a click from
  // a menu or the checklist passes nothing, which is the `undefined` case.
  const cmd = <A>(id: string, fn: (arg?: A) => Promise<void> | void) =>
    ctx.subscriptions.push(vscode.commands.registerCommand(id, async (arg?: A) => {
      try { await fn(arg); } catch (e) { report(e, out); }
    }));

  cmd('semlayer.showOutput', () => out.show());

  cmd('semlayer.openSetting', async () => {
    // Opens Settings filtered to the one setting, rather than telling the user
    // to go and find it. The panel named it; this is the thing that names it.
    await vscode.commands.executeCommand('workbench.action.openSettings',
                                         'semlayer.cliPath');
  });

  cmd('semlayer.recheck', async () => {
    await refresh();
    const found = (await version()) !== null;
    vscode.window.showInformationMessage(found
      ? 'Found the engine. You are ready to create a semantic layer.'
      : 'Still no engine. If the install is still running, give it a moment and press '
        + 'Check again.');
  });

  cmd('semlayer.install', () => {
    // We are asking the user to run a script from the internet, so it runs
    // where they can see it. Hiding that would be the wrong trade for a
    // product whose claim is that it tells you what it is doing.
    const [first] = engineInstallers();
    const term = vscode.window.createTerminal('semlayer: install the engine');
    term.show();
    term.sendText(first.command);

    // A terminal command is fire-and-forget: there is no completion event to
    // wait on. So poll for the binary appearing, and stop as soon as it does.
    // Without this the user watches "everything's installed!" scroll past and
    // is left looking at the same install panel with nothing to press -- which
    // is exactly what happened the first time a person tried it.
    void watchForEngine(refresh);
  });

  cmd('semlayer.openWalkthrough', async () => {
    await vscode.commands.executeCommand('workbench.action.openWalkthrough',
      `${ctx.extension.id}#semlayer.setup`, false);
  });

  cmd('semlayer.selectLayer', async () => {
    const found = await layers.discover();
    if (!found.length) {
      vscode.window.showInformationMessage('No semantic layer found in this workspace.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      found.map((l) => ({ label: l.name, description: `${l.tables} tables`,
                          detail: vscode.workspace.asRelativePath(l.uri), layer: l })),
      { title: 'Lint against which semantic layer?' });
    if (!pick) { return; }
    await vscode.workspace.getConfiguration('semlayer')
      .update('layerPath', pick.layer.uri.fsPath, vscode.ConfigurationTarget.Workspace);
  });

  cmd('semlayer.loadLayer', async () => {
    const found = await layers.discover();
    if (found.length) { await vscode.commands.executeCommand('semlayer.selectLayer'); return; }
    // No offer of the sample here. There is no `semlayer demo` command, so
    // that button led nowhere -- and it led nowhere from the FIRST thing a new
    // user clicks, which is the worst place to put a dead end.
    vscode.window.showInformationMessage(
      'No semantic layer in this folder yet.',
      'Create one', 'Open a layer file').then(async (a) => {
        if (a === 'Create one') { void vscode.commands.executeCommand('semlayer.createLayer'); }
        if (a === 'Open a layer file') {
          const picked = await vscode.window.showOpenDialog({
            title: 'Open a semantic layer', canSelectMany: false,
            filters: { 'Semantic layer': ['yaml', 'yml'] } });
          if (picked?.[0]) {
            await vscode.workspace.getConfiguration('semlayer')
              .update('layerPath', picked[0].fsPath, vscode.ConfigurationTarget.Workspace);
            layers.invalidate();
            await refresh();
          }
        }
      });
  });

  /** Probe a chosen warehouse, then show the bill. The tail of every route. */
  const toScope = async (source: string, expanded = false) => {
    lastSource = source;
    panel.noteSource(source);
    const p = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Reading ${source}` },
      () => flows.probe(source, out));

    if (!p) {
      vscode.window.showErrorMessage(
        `semlayer could not read ${source}.`, 'Show output', 'Grants I might need')
        .then((a) => {
          if (a === 'Show output') { out.show(); }
          if (a === 'Grants I might need') { void flows.showGrants(source, out); }
        });
      return;
    }
    await panel.showScope(p, source, expanded);
  };

  /**
   * The warehouse to act on.
   *
   * `lastSource` only knows what THIS session picked and a reload clears it,
   * so it falls back to the one the layer records being built from. Every
   * command that needs a warehouse goes through here; the ones that read
   * `lastSource` directly all failed the same way on a fresh window.
   */
  const currentSource = async (): Promise<string | undefined> =>
    lastSource ?? (await layers.active())?.warehouse ?? undefined;

  /** Lint against a layer the user picked, and settle into the resting state. */
  const useLayerFile = async (fsPath: string) => {
    await vscode.workspace.getConfiguration('semlayer')
      .update('layerPath', fsPath, vscode.ConfigurationTarget.Workspace);
    layers.invalidate();
    await refresh();
  };

  // Step one. With no layer the sidebar is already showing it, so this is the
  // way BACK to it -- from the sample to a real warehouse, say.
  cmd('semlayer.createLayer', async () => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Looking for warehouses' },
      () => panel.showConnect());
  });

  // Step two from the checklist. It needs a warehouse to show a bill for.
  //
  // `lastSource` only knows what THIS session picked, and a reload clears it
  // -- which is the state most people are in, since reloading is how the
  // extension gets installed. So fall back to the warehouse the layer records
  // having been built from. Only with neither does this send you to step one.
  cmd('semlayer.createStep', async (opts?: { settings?: boolean }) => {
    const source = await currentSource();
    if (!source) {
      await vscode.commands.executeCommand('semlayer.createLayer');
      return;
    }
    await toScope(source, opts?.settings === true);
  });

  // Day 2. Not a step -- the place you come back to once the three are done.
  cmd('semlayer.home', () => panel.goHome());

  // Step three.
  cmd('semlayer.serve', async () => {
    if (!(await layers.active())) {
      await vscode.commands.executeCommand('semlayer.createLayer');
      return;
    }
    await panel.showServe();
  });

  // The connect screen posts its one decision here. The panel renders step
  // one; acting on it belongs where probing and spending already live.
  panel.onMessage = (m) => void (async () => {
    if (m.type === 'cancel') { await panel.leaveConnect(); return; }
    if (m.type === 'sample') {
      await panel.leaveConnect();
      await vscode.commands.executeCommand('semlayer.trySample');
      return;
    }
    if (m.type === 'layer' && m.source) {
      await panel.leaveConnect();
      await useLayerFile(m.source);
      return;
    }
    if (m.type === 'browse') {
      const picked = await vscode.window.showOpenDialog({
        title: 'Open a semantic layer', canSelectMany: false,
        filters: { 'Semantic layer': ['yaml', 'yml'] } });
      // Cancelling the dialog leaves the user on the list, not nowhere.
      if (picked?.[0]) {
        await panel.leaveConnect();
        await useLayerFile(picked[0].fsPath);
      }
      return;
    }
    if (m.type === 'use' && m.source) {
      await panel.leaveConnect();
      await toScope(m.source);
      return;
    }
    if (m.type === 'home') { await panel.goHome(); return; }
    // --- step three -----------------------------------------------------
    if (m.type === 'client' && m.source) {
      const layer = await layers.active();
      const client = mcp.clients().find((c) => c.label === m.source);
      if (layer && client) {
        await mcp.configure(client, layer.uri);
        await refresh();
        vscode.window.showInformationMessage(
          `${client.label} now serves ${layer.name}. Restart it to pick the server up.`);
      }
      return;
    }
    if (m.type === 'copy' && m.source) {
      await vscode.env.clipboard.writeText(m.source);
      vscode.window.showInformationMessage('Copied.');
      return;
    }
    // --- step two -------------------------------------------------------
    if (m.type === 'settings' && m.state) { flows.setSettings(m.state); return; }
    if (m.type === 'back') { await panel.leaveScope(); await panel.showConnect(); return; }
    if (m.type === 'create' && lastSource) {
      // The screen stays up, showing the run. Leaving first dropped the
      // sidebar back to step one, so Create looked like it had undone itself.
      await panel.setRunning(true);
      const started = Date.now();
      try {
        await infer(lastSource, out, refresh);
      } finally {
        // A floor on how briefly the running state can exist. Deterministic
        // inference over the 36-table sample finishes in about four seconds,
        // and the webview has to paint before it can be seen at all -- so the
        // bar was correct and invisible. This does not fake progress or delay
        // the result; it stops a real state from flashing past unread.
        const shown = Date.now() - started;
        if (shown < MIN_RUNNING_MS) {
          await new Promise((r) => setTimeout(r, MIN_RUNNING_MS - shown));
        }
        await panel.leaveScope();
      }
    }
  })();

  // "Rebuild with settings" IS step two: the Create screen carries the bill
  // and the same settings form, so a second screen for them would be the
  // duplicate shape this extension keeps being bitten by. It opened one, and
  // it read `lastSource`, which a reload clears -- so on day 2, the day it is
  // for, it asked you to type the warehouse in and did nothing if you did not.
  cmd('semlayer.settings', async () => {
    // Expanded, because the settings are what was asked for by name.
    await vscode.commands.executeCommand('semlayer.createStep', { settings: true });
  });

  cmd('semlayer.grants', async () => {
    const source = await currentSource() ?? await askSource();
    if (!source) { return; }
    await flows.showGrants(source, out);
  });

  cmd('semlayer.drift', async () => {
    const layer = await layers.active();
    if (!layer) { vscode.window.showInformationMessage('No layer selected.'); return; }
    const source = await sourceFor(layer.uri);
    if (!source) {
      vscode.window.showWarningMessage(
        'This layer does not name a warehouse, so drift cannot be checked.');
      return;
    }
    const d = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Checking for drift' },
      () => readDrift(layer.uri, source).catch((e) => {
        out.appendLine(`drift: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }));

    panel.setDrift(d);
    if (!d || !d.events.length) {
      vscode.window.showInformationMessage('No drift: the warehouse matches this layer.');
      return;
    }
    flows.showDrift(d, layer.name, (tables) => {
      // The targeted path: profile only what changed and fold it back in.
      void inferInto(source, layer.uri, tables, out, refresh);
    });
  });

  cmd('semlayer.stitch', async () => {
    const found = await layers.discover();
    if (found.length < 2) {
      vscode.window.showInformationMessage(
        'Stitching needs more than one layer in the workspace.');
      return;
    }
    const target = await vscode.window.showSaveDialog({
      title: 'Write the hub to', saveLabel: 'Stitch',
      defaultUri: vscode.Uri.joinPath(found[0].uri, '..', 'hub.yaml') });
    if (!target) { return; }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Inferring the seam' },
      async () => {
        const { code, stdout, stderr } = await run(
          ['stitch', ...found.map((l) => l.uri.fsPath), '-o', target.fsPath],
          { timeoutMs: 600_000 });
        out.appendLine(stdout || stderr);
        if (code === 0) {
          layers.invalidate();
          await refresh();
          await vscode.window.showTextDocument(target);
        } else {
          vscode.window.showErrorMessage('Stitch failed.', 'Show output')
            .then((a) => { if (a) { out.show(); } });
        }
      });
  });

  cmd('semlayer.trySample', async () => {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) {
      vscode.window.showWarningMessage('Open a folder first; the sample is written into it.');
      return;
    }
    const target = vscode.Uri.joinPath(root.uri, 'messy_mart.duckdb');

    const ok = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Writing a sample warehouse (36 tables)',
    }, async () => {
      const { code, stdout, stderr } = await run(
        ['demo', '-o', target.fsPath], { cwd: root.uri.fsPath, timeoutMs: 300_000 });
      out.appendLine(stdout || stderr);
      return code === 0;
    });

    if (!ok) {
      vscode.window.showErrorMessage('Could not write the sample.', 'Show output')
        .then((a) => { if (a) { out.show(); } });
      return;
    }
    // Straight into the thing it exists for. A sample you then have to work
    // out what to do with is only half an answer.
    //
    // Through `toScope` rather than probing here: this path had its own copy,
    // which meant it skipped `panel.noteSource` and the checklist never ticked
    // step one for the sample -- the one route a first-time user is most
    // likely to take.
    await toScope(`duckdb:${target.fsPath}`);
  });

  cmd('semlayer.review', async () => {
    const layer = await layers.active();
    if (!layer) { vscode.window.showInformationMessage('No layer selected.'); return; }
    await ReviewPanel.show(layer.uri, out, () => void refresh());
  });

  cmd('semlayer.configureClient', async () => {
    const layer = await layers.active();
    if (!layer) { vscode.window.showInformationMessage('Create a layer first.'); return; }
    const all = mcp.clients();
    const state = await Promise.all(all.map((c) => mcp.stateOf(c)));
    const DESC: Record<mcp.ClientState, string> = {
      configured: 'semlayer is already in its config',
      present: '',
      absent: 'no config file here yet',
    };
    const pick = await vscode.window.showQuickPick(
      all.map((c, i) => ({
        label: c.label,
        description: DESC[state[i]],
        detail: c.file, client: c,
      })),
      { title: 'Connect which MCP client?' });
    if (!pick) { return; }
    await mcp.configure(pick.client, layer.uri);
    await refresh();
    vscode.window.showInformationMessage(
      `${pick.label} now serves ${layer.name}. Restart it to pick the server up.`);
  });

  await refresh();
}

/**
 * Context keys the walkthrough watches, so its steps tick themselves off as
 * the state they describe becomes true rather than when a button was pressed.
 */
async function setContexts(): Promise<void> {
  const [cli, layer] = await Promise.all([version(), layers.active()]);
  await vscode.commands.executeCommand('setContext', 'semlayer.hasCli', !!cli);
  await vscode.commands.executeCommand('setContext', 'semlayer.hasLayer', !!layer);
}

async function updateStatus(): Promise<void> {
  const layer = await layers.active();
  if (!layer) { status.hide(); return; }
  status.text = `$(database) ${layer.name}`;
  status.tooltip = `semlayer: linting against ${layer.uri.fsPath}`;
  status.show();
}

/**
 * The warehouse a command is about.
 *
 * Remembered for the session so Settings, Grants and a rebuild do not each ask
 * again for a connection string the user typed a minute ago.
 */
let lastSource: string | undefined;

async function askSource(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Which warehouse?',
    prompt: 'semlayer reads it and never writes to it.',
    value: lastSource,
    placeHolder: 'duckdb:warehouse.duckdb | snowflake:my_conn | bigquery:my-project | postgresql://…',
    ignoreFocusOut: true,
  });
}

/**
 * The warehouse a layer was built from, read back out of the document.
 *
 * Worth knowing: the engine records this RELATIVE to wherever inference ran
 * (`warehouse: duckdb:messy_mart.duckdb`), so a layer moved to another folder
 * names a file that is not there. Resolved against the document's own
 * directory here, which is the only interpretation that travels with the file.
 */
async function sourceFor(doc: vscode.Uri): Promise<string | undefined> {
  let text: string;
  try {
    text = Buffer.from(await vscode.workspace.fs.readFile(doc)).toString('utf8');
  } catch {
    return undefined;
  }
  const m = /^\s*warehouse:\s*(\S.*)$/m.exec(text);
  if (!m) { return undefined; }
  const raw = m[1].trim().replace(/^['"]|['"]$/g, '');
  if (!raw.startsWith('duckdb:')) { return raw; }

  const file = raw.slice('duckdb:'.length);
  if (file.startsWith('/')) { return raw; }
  return `duckdb:${vscode.Uri.joinPath(doc, '..', file).fsPath}`;
}

/**
 * Re-infer only the tables that drifted and fold the result back in.
 *
 * `--only` plus `--into` is the targeted half of re-inference: reviewed and
 * certified content is kept, disagreement is recorded as a conflict, and a
 * column the warehouse no longer has becomes orphaned rather than deleted.
 */
async function inferInto(source: string, doc: vscode.Uri, tables: string[],
                         out: vscode.OutputChannel, refresh: () => Promise<void>): Promise<void> {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Re-inferring ${tables.length} table${tables.length === 1 ? '' : 's'}`,
    cancellable: true,
  }, async (_p, token) => {
    const { code, stdout, stderr } = await run(
      // No `-o`: `--into` already says where the result goes.
      ['infer', source, '--only', tables.join(','), '--into', doc.fsPath,
       ...settingsToArgs(flows.currentSettings(), { withOut: false })],
      { cwd: vscode.Uri.joinPath(doc, '..').fsPath, token });
    out.appendLine(stdout || stderr);
    invalidateDrift();
    invalidateFindings();
    layers.invalidate();
    await refresh();
    if (code !== 0) {
      vscode.window.showErrorMessage('Re-inference failed.', 'Show output')
        .then((a) => { if (a) { out.show(); } });
    }
  });
}

async function infer(source: string, out: vscode.OutputChannel,
                     refresh: () => Promise<void>): Promise<void> {
  // A run is a job, not a modal: it is minutes on a real warehouse, and it
  // resumes from cache if it is interrupted.
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Inferring a semantic layer from ${source}`,
    cancellable: true,
  }, async (_progress, token) => {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const { code, stderr, stdout } = await run(
      ['infer', source, ...settingsToArgs(flows.currentSettings())], { cwd: root, token });
    out.appendLine(stdout || stderr);
    if (code === 0) {
      // Wait for the file to appear in VS Code's index before redrawing: the
      // engine has just written it from outside the editor, and a refresh
      // that lands first finds no layer and shows "connect a warehouse".
      await layers.waitForLayer();
      await refresh();
      vscode.window.showInformationMessage('Semantic layer written.', 'Show output')
        .then((a) => { if (a) { out.show(); } });
    } else {
      vscode.window.showErrorMessage('Inference failed. See the semlayer output.', 'Show output')
        .then((a) => { if (a) { out.show(); } });
    }
  });
}

/**
 * Wait for an install running in a terminal to produce an engine.
 *
 * Bounded: two minutes at two-second intervals, then it gives up quietly and
 * leaves the panel's own Check again button as the way forward. It never
 * reports failure, because a slow download is not a failure.
 */
async function watchForEngine(refresh: () => Promise<void>): Promise<void> {
  const DEADLINE_MS = 120_000;
  const STEP_MS = 2_000;
  const started = Date.now();

  while (Date.now() - started < DEADLINE_MS) {
    await new Promise((r) => setTimeout(r, STEP_MS));
    await refresh();
    if ((await version()) !== null) {
      vscode.window.showInformationMessage(
        'semlayer is ready. Create a semantic layer from a warehouse to begin.',
        'Create').then((a) => {
          if (a) { void vscode.commands.executeCommand('semlayer.createLayer'); }
        });
      return;
    }
  }
}

function report(e: unknown, out: vscode.OutputChannel): void {
  if (e instanceof vscode.CancellationError) { return; }
  const msg = e instanceof CliError ? e.message : e instanceof Error ? e.message : String(e);
  out.appendLine(msg);
  if (e instanceof CliError && e.stderr) { out.appendLine(e.stderr); }
  vscode.window.showErrorMessage(`semlayer: ${msg}`, 'Show output')
    .then((a) => { if (a) { out.show(); } });
}

export function deactivate(): void { /* disposables handle it */ }

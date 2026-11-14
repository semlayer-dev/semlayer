/**
 * Checks every feature in the manifest against the thing that proves it.
 *
 * This is the test that answers "are we missing screens" without anyone
 * installing the extension and clicking around. It deliberately does NOT
 * assert on wording beyond the few phrases that carry meaning -- a test that
 * pins every sentence makes copy edits fail the build, and the copy in this
 * extension has needed several.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { FEATURES, byKind } from './features.mjs';
import { VIEWS } from '../scripts/shoot.mjs';
import * as V from '../out/views.js';
import * as F from './fixtures.mjs';
import * as E from '../out/engine.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const commands = new Set(pkg.contributes.commands.map((c) => c.command));
const settings = new Set(Object.keys(pkg.contributes.configuration.properties));
const walkthroughs = new Set(pkg.contributes.walkthroughs.map((w) => w.id));
const rendered = new Map(VIEWS.map((v) => [v.name, v.html()]));

describe('manifest', () => {
  test('every feature has an id and a description', () => {
    for (const f of FEATURES) {
      assert.ok(f.id, 'missing id');
      assert.ok(f.what, `${f.id}: missing description`);
    }
  });

  test('ids are unique', () => {
    const seen = new Set();
    for (const f of FEATURES) {
      assert.ok(!seen.has(f.id), `duplicate id ${f.id}`);
      seen.add(f.id);
    }
  });

  test('every gap says why', () => {
    for (const f of byKind('gap')) {
      assert.ok(f.why, `${f.id}: a gap must record why it is a gap`);
    }
  });
});

describe('contributes', () => {
  for (const f of byKind('contributes')) {
    test(`${f.id} — ${f.what}`, () => {
      if (f.command) { assert.ok(commands.has(f.command), `${f.command} is not declared`); }
      if (f.setting) { assert.ok(settings.has(f.setting), `${f.setting} is not declared`); }
      if (f.walkthrough) {
        assert.ok(walkthroughs.has(f.walkthrough), `${f.walkthrough} is not declared`);
      }
    });
  }

  test('build.prepublish — packaging compiles first', () => {
    // `vsce package` ships whatever is in dist/. Run on its own it does not
    // build, so a package built straight after an edit shipped a bundle from
    // hours earlier: every test here passed (they read out/, which tsc had
    // just rebuilt) and the installed extension was the old one. vsce always
    // runs `vscode:prepublish`, so the hook is the fix; this keeps it.
    assert.equal(pkg.scripts['vscode:prepublish'], 'npm run compile',
      'without this hook `vsce package` can ship a stale dist/extension.js');
  });

  test('every declared command is implemented', () => {
    // A command in package.json with no registerCommand is a palette entry
    // that throws when chosen.
    const src = readFileSync(new URL('../src/extension.ts', import.meta.url), 'utf8');
    for (const c of commands) {
      assert.ok(src.includes(`'${c}'`), `${c} is declared but never registered`);
    }
  });
});

describe('render', () => {
  test('every view in the shoot list renders non-empty HTML', () => {
    for (const [name, html] of rendered) {
      assert.ok(html.startsWith('<!DOCTYPE html>'), `${name}: not a document`);
      assert.ok(html.length > 400, `${name}: suspiciously short`);
    }
  });

  for (const f of byKind('render')) {
    test(`${f.id} — ${f.what}`, () => {
      const html = rendered.get(f.view);
      assert.ok(html, `no view named ${f.view} in the shoot list`);
      for (const needle of f.contains ?? []) {
        assert.ok(html.includes(needle), `${f.view} does not contain ${JSON.stringify(needle)}`);
      }
      for (const needle of f.absent ?? []) {
        assert.ok(!html.includes(needle), `${f.view} should not contain ${JSON.stringify(needle)}`);
      }
    });
  }

  test('no view leaks an unresolved template expression', () => {
    for (const [name, html] of rendered) {
      assert.ok(!html.includes('${'), `${name}: an unresolved \${...} reached the output`);
      assert.ok(!html.includes('undefined'), `${name}: the word undefined reached the output`);
    }
  });

  test('the no-engine panel always offers a way forward', () => {
    // It rendered once with no install command and no button: the route had
    // resolved, a second redundant check timed out, and neither branch had
    // anything to show. A panel that says "no engine" and offers nothing is
    // the worst screen this extension can produce.
    const html = rendered.get('panel-no-cli');
    assert.match(html, /Run this in a terminal/);
    assert.match(html, /astral\.sh\/uv/);
    assert.match(html, /Check again/);
  });

  test('every action is a button, never bare text', () => {
    // Two affordances only: a filled button does something, grey text does
    // nothing. `class="link"` was a third that had no CSS behind it, so it
    // rendered as plain grey text -- a control nobody could see was a control,
    // which is the same defect reported twice before and reintroduced here.
    for (const [name, html] of rendered) {
      assert.ok(!html.includes('class="sec"'),
        `${name}: the secondary button style is unusable at sidebar contrast`);
      assert.ok(!html.includes('class="link"'),
        `${name}: class="link" has no CSS and renders as plain text`);
    }
  });

  test('no view leaks a class with no CSS behind it', () => {
    // The affordance bug: `button.sec` resolved to a background VS Code does
    // not always define, so controls rendered as centred plain text.
    for (const [name, html] of rendered) {
      assert.ok(!html.includes('class="sec"'),
        `${name}: the secondary button style is unusable at sidebar contrast`);
    }
  });
});

describe('logic', () => {
  test('create.settings.args — settings translate to real flag spellings', () => {
    assert.deepEqual(V.settingsToArgs(F.SETTINGS), []);
    assert.deepEqual(
      V.settingsToArgs({ ...F.SETTINGS, noLlm: true, noSampleEgress: true, schema: 'finance' }),
      ['--no-llm', '--no-sample-egress', '--schema', 'finance']);
    // 4 is the default and must not be emitted, or every run differs from
    // the documented command for no reason.
    assert.deepEqual(V.settingsToArgs({ ...F.SETTINGS, llmWorkers: 4 }), []);
    assert.deepEqual(V.settingsToArgs({ ...F.SETTINGS, llmWorkers: 8 }), ['--llm-workers', '8']);
  });

  test('create.settings.live — no setting is inert', () => {
    // "Open a pull request when I am done reviewing" was a checkbox with a
    // default, a label and no effect whatsoever: no flag, no reader, and no
    // verb in the engine behind it. Nothing here caught it, because the
    // manifest checks that claims have evidence and never that a rendered
    // control has a claim. Every setting must now change the command.
    const bump = (v) => (typeof v === 'boolean' ? !v
      : typeof v === 'number' ? v + 4
      : Array.isArray(v) ? ['./docs']
      : v === null ? 2
      : 'x');
    for (const key of Object.keys(V.DEFAULT_SETTINGS)) {
      const moved = { ...F.SETTINGS, [key]: bump(F.SETTINGS[key]) };
      assert.notDeepEqual(V.settingsToArgs(moved), V.settingsToArgs(F.SETTINGS),
        `${key} is in the form and in the state but changes nothing that runs`);
    }
  });

  test('create.settings.model — a chosen model reaches the command', () => {
    assert.deepEqual(V.settingsToArgs({ ...F.SETTINGS, model: 'claude-opus-4-5' }),
      ['--model', 'claude-opus-4-5']);
    // Deterministic mode makes no model calls, so naming one would put a flag
    // on the command line that contradicts the one next to it.
    assert.deepEqual(
      V.settingsToArgs({ ...F.SETTINGS, noLlm: true, model: 'claude-opus-4-5' }),
      ['--no-llm']);
    assert.deepEqual(V.settingsToArgs({ ...F.SETTINGS, model: '   ' }), [],
      'whitespace is not a model id');
  });

  test('create.settings.out — the output path reaches the command, except with --into', () => {
    assert.deepEqual(V.settingsToArgs({ ...F.SETTINGS, out: 'finance.yaml' }),
      ['-o', 'finance.yaml']);
    // Targeted re-inference passes --into, and -o alongside it would be two
    // answers to where the result goes.
    assert.deepEqual(
      V.settingsToArgs({ ...F.SETTINGS, out: 'finance.yaml' }, { withOut: false }), []);
  });

  test('review.badge — a count badges, zero and unknown do not', () => {
    assert.deepEqual(V.badgeFor(20), { value: 20, tooltip: '20 findings to review' });
    assert.deepEqual(V.badgeFor(1), { value: 1, tooltip: '1 finding to review' });
    // Zero is said in words in the panel; a badge is an interruption and
    // "you are done" is not one. Null is unknown, and an unknown count must
    // never be drawn as a number.
    assert.equal(V.badgeFor(0), undefined);
    assert.equal(V.badgeFor(null), undefined);
    assert.equal(V.badgeFor(undefined), undefined);
  });

  test('review.stakes — consequential questions sort first', () => {
    const sorted = V.sortQuestions(F.QUEUE.questions);
    assert.ok(V.CONSEQUENTIAL.has(sorted[0].kind), 'a naming question is at the top');
    const lastTwo = sorted.slice(-2).every((q) => !V.CONSEQUENTIAL.has(q.kind));
    assert.ok(lastTwo, 'bookkeeping questions are not at the bottom');
  });

  test('day2.drift.quiet — no drift reads as calm', () => {
    assert.equal(V.driftLine(null), null);
    assert.equal(V.driftLine({ ...F.DRIFT, events: [] }), null);
    assert.match(V.driftLine(F.DRIFT), /2 new tables/);
  });

  test('connect.sidebar — step one renders in the sidebar, not an editor tab', () => {
    // `renderPanel` IS the sidebar. Connect must come out of it, and must win
    // over the resting state: "Connect another warehouse" on day 2 leads here
    // with a layer already loaded, and that used to open an editor tab.
    const withLayer = { ...F.PANEL_STATES['panel-resting'], connect: F.CONNECT };
    const html = V.renderPanel(withLayer);
    assert.ok(html.includes('Or start from a warehouse'), 'connect is what rendered');
    assert.ok(!html.includes('MCP clients'), 'and it replaced the resting state');

    // An editor tab is `wide`, which repaints the background. The sidebar must
    // not be: it would read as a document dropped into the side panel.
    assert.ok(!html.includes('--vscode-editor-background'), 'sidebar background');
  });

  test('create.sidebar — step two renders in the sidebar, where step one was', () => {
    const s = { ...F.PANEL_STATES['panel-connect'], scope: F.SCOPE,
                connect: F.CONNECT_EMPTY };
    const html = V.renderPanel(s);
    assert.ok(html.includes('36 tables found'), 'scope is what rendered');
    assert.ok(!html.includes('Start from a warehouse'), 'and it beat connect');
    // Same reason as connect: `wide` is the editor-tab background, and step
    // two opening in the centre pane is what made the flow feel like it left
    // the product halfway through.
    assert.ok(!html.includes('--vscode-editor-background'), 'sidebar background');
  });

  test('meta.screen — navigation cannot be swallowed by another screen', () => {
    const both = { hasLayer: true, hasScope: true };

    // THE REGRESSION, three times over. Each of these is a click that landed
    // on a screen the sidebar was already showing something else on, and each
    // one silently did nothing because the previous screen still won.
    assert.equal(V.screenFor('connect', both), 'connect', 'step 1 from Create');
    assert.equal(V.screenFor('serve', both), 'serve', 'step 3 from Create');
    assert.equal(V.screenFor('home', both), 'home', 'Back to the layer');
    assert.equal(V.screenFor('scope', both), 'scope', 'step 2 from Serve');

    // A screen with nothing behind it falls through rather than rendering
    // empty: serve needs a layer, scope needs a probed warehouse.
    assert.equal(V.screenFor('serve', { hasLayer: false, hasScope: false }), 'connect');
    assert.equal(V.screenFor('scope', { hasLayer: true, hasScope: false }), 'home');

    // Nowhere in particular: the layer if there is one, step one if not.
    assert.equal(V.screenFor(undefined, { hasLayer: true, hasScope: false }), 'home');
    assert.equal(V.screenFor(undefined, { hasLayer: false, hasScope: false }), 'connect');
  });

  test('meta.steps.navigate — every step row opens a screen', () => {
    // The regression this guards: two of the three rows used to fire commands
    // that opened an editor tab and a quick-pick, so a navigation bar did not
    // navigate. Each command here must be one the extension registers.
    const html = V.renderPanel(F.panelState('panel-connect'));
    const cmds = [...html.matchAll(/class="step act [a-z]+"\s+data-cmd="([^"]+)"/g)]
      .map((m) => m[1]);
    assert.equal(cmds.length, 3, 'three rows, three commands');
    assert.deepEqual(cmds, ['semlayer.createLayer', 'semlayer.createStep',
                            'semlayer.serve']);
    for (const c of cmds) {
      assert.ok(commands.has(c), `${c} is declared in package.json`);
    }
  });

  test('meta.plural — counts read correctly at one', () => {
    assert.equal(V.plural(1, 'table'), '1 table');
    assert.equal(V.plural(0, 'table'), '0 tables');
    assert.equal(V.plural(2000, 'table'), '2,000 tables');
  });

  test('meta.cliArgs — cliPath takes a command with arguments', () => {
    // The setting held only a binary path, so the one user who needs uvx most
    // -- the one with no Python -- had a working engine and no way to say so.
    assert.deepEqual(E.splitCommand('semlayer'), ['semlayer']);
    assert.deepEqual(E.splitCommand('uvx --from semlayer[warehouses] semlayer'),
                     ['uvx', '--from', 'semlayer[warehouses]', 'semlayer']);
    assert.deepEqual(E.splitCommand('"/opt/my tools/semlayer" --quiet'),
                     ['/opt/my tools/semlayer', '--quiet']);
    assert.deepEqual(E.splitCommand('   '), []);
  });

  test('pip is offered, not hidden under pipx', () => {
    // A note hanging off the pipx line was a dead end for anyone who has pip
    // and not pipx -- which is most people with Python, since pipx is itself
    // one more thing to install.
    for (const platform of ['linux', 'darwin', 'win32']) {
      const labels = E.installers(platform).map((i) => i.label);
      assert.ok(labels.includes('With pip'), `${platform} does not offer pip`);
      assert.ok(labels.includes('With pipx'), `${platform} does not offer pipx`);
    }
  });

  test('the bootstrap never assumes Python, on any platform', () => {
    for (const platform of ['linux', 'darwin', 'win32']) {
      const first = E.installers(platform)[0];
      assert.match(first.command, /astral\.sh\/uv/,
        `${platform} is not offered a Python-free bootstrap first`);
    }
    assert.match(E.installers('win32')[0].command, /powershell/);
    assert.match(E.installers('darwin').map((i) => i.command).join(' '), /brew/);
    // Python routes are offered, but never first: they are the ones that fail
    // on a machine that has none.
    for (const platform of ['linux', 'darwin', 'win32']) {
      const commands = E.installers(platform).map((i) => i.command);
      const pythonAt = commands.findIndex((c) => /pipx|pip /.test(c));
      assert.ok(pythonAt > 0, `${platform} leads with a Python install`);
    }
  });

  test('a route is probed by its launcher, not by its whole dependency tree', () => {
    // Probing uvx by running `uvx ... semlayer --help` fetches Python and 65
    // packages on a machine that has neither: minutes of work behind a
    // ten-second timeout. The panel then said "still no engine" while uvx was
    // sitting on the PATH. Reported by a user doing exactly that.
    assert.deepEqual(E.probeFor(E.UVX_ARGV), ['uvx', '--version']);
    assert.deepEqual(E.probeFor(['/home/me/.local/bin/uvx', '--from', 'x', 'semlayer']),
                     ['/home/me/.local/bin/uvx', '--version']);
    assert.deepEqual(E.probeFor(['C:\\Users\\me\\.local\\bin\\uvx.exe', '--from', 'x']),
                     ['C:\\Users\\me\\.local\\bin\\uvx.exe', '--version']);
    // A direct install is cheap to ask, so ask it properly.
    assert.deepEqual(E.probeFor(['semlayer']), ['semlayer', '--help']);
    assert.deepEqual(E.probeFor(['/opt/semlayer']), ['/opt/semlayer', '--help']);
  });

  test('the uvx route pins a Python version', () => {
    // Unpinned, uv downloads the newest CPython on a machine that has none,
    // and duckdb has no wheel for it: the build falls back to source, wants
    // CMake, and fails after 2m33s. Reproduced in a sandbox holding only a
    // shell, curl and coreutils -- which is the machine this route is for.
    const i = E.UVX_ARGV.indexOf('--python');
    assert.ok(i > 0, 'the uvx invocation lost its --python pin');
    assert.match(E.UVX_ARGV[i + 1], /^3\.\d+$/);
    assert.ok(E.UVX_ARGV.indexOf('--from') > i, '--from must follow the pin');
  });

  test('resolve prefers a real binary, and offers an install over routing via uvx',
       async () => {
    const probe = (works) => ({ works: async (argv) => works.includes(argv[0]) });
    assert.equal((await E.resolve('semlayer', probe(['semlayer']))).kind, 'path');

    // A machine with uv but no engine gets an INSTALL, not a uvx route.
    // Routing calls through `uvx --from semlayer[warehouses]` paid the 65-package
    // fetch inside whichever call ran first -- here the panel's `--help` probe,
    // which timed out and hid the sample-warehouse button for the session. The
    // download is unavoidable; what is avoidable is hiding it inside a call
    // something is already timing.
    const viaUv = await E.resolve('semlayer', probe(['uv']));
    assert.equal(viaUv.kind, 'install');
    assert.match(viaUv.via.command, /uv tool install/,
      'with uv present, the offer must install the engine, not uv again');
    assert.match(viaUv.via.command, /--python 3\.\d+/, 'the install keeps the Python pin');

    // uvx alone is not a route: uv is what we look for.
    assert.equal((await E.resolve('semlayer', probe(['uvx']))).kind, 'install');

    // Nothing at all: bootstrap uv first.
    const bare = await E.resolve('semlayer', probe([]));
    assert.equal(bare.kind, 'install');
    assert.match(bare.via.command, /astral\.sh|brew|winget/,
      'with no uv, the offer must install uv itself');

    // A configured command wins even when `semlayer` is on PATH: they set it
    // for a reason.
    const chosen = await E.resolve('/opt/semlayer', probe(['/opt/semlayer', 'semlayer']));
    assert.equal(chosen.kind, 'configured');
    assert.deepEqual(chosen.argv, ['/opt/semlayer']);

    // A uvx command someone configured deliberately is still honoured, and
    // still flagged, because its first call fetches.
    const byHand = await E.resolve('uvx --from "semlayer[warehouses]" semlayer',
                                   probe(['uvx']));
    assert.equal(byHand.kind, 'uvx');
  });

  test('estimate — deterministic is free and labelled', () => {
    assert.equal(V.estimate(36, true).spend, '$0.00');
    assert.match(V.estimate(15000, false).spend, /^~\$\d/);
  });
});

describe('coverage', () => {
  /**
   * Every `cli` feature names a verb the engine actually has.
   *
   * These entries carried NO assertion until now: the manifest's own header
   * says a feature whose evidence fails is not built, and `kind: 'cli'` had no
   * evidence at all. That is how `connect.discovery` sat as a gap reading "no
   * CLI verb does this" while `session.discover()` was a public function, and
   * how a button could be wired to a verb the installed engine lacks.
   *
   * Skipped with no engine, because a skip is honest and a mock is not.
   */
  test('every cli feature names a verb this engine has', () => {
    const cliPath = process.env.SEMLAYER_CLI
      ?? join(homedir(), 'semanticData/oss/.venv/bin/semlayer');
    if (!existsSync(cliPath)) { return; }
    const help = execFileSync(cliPath, ['--help'], { encoding: 'utf8', timeout: 120_000 });
    const verbs = new Set((/\{([a-z,]+)\}/.exec(help)?.[1] ?? '').split(','));
    for (const f of byKind('cli')) {
      assert.ok(verbs.has(f.verb),
        `${f.id} needs \`semlayer ${f.verb}\`, which this engine does not have `
        + `(it has: ${[...verbs].join(', ')})`);
      // A verb is not enough when the feature is a flag on it: the model
      // picker is a form field whose entire function is one flag, and a
      // field that renders beside an engine without it is a lie.
      if (f.flag) {
        const sub = execFileSync(cliPath, [f.verb, '--help'],
          { encoding: 'utf8', timeout: 120_000 });
        assert.ok(sub.includes(f.flag),
          `${f.id} needs \`semlayer ${f.verb} ${f.flag}\`, which this engine lacks`);
      }
    }
  });

  test('every render feature names a view that exists', () => {
    for (const f of byKind('render')) {
      assert.ok(rendered.has(f.view), `${f.id} names a missing view ${f.view}`);
    }
  });

  test('every shoot view is claimed by at least one feature', () => {
    // A view nobody asserts on is a screen nobody is checking.
    const claimed = new Set(byKind('render').map((f) => f.view));
    const unclaimed = [...rendered.keys()].filter((v) => !claimed.has(v));
    assert.deepEqual(unclaimed, [],
      `these views have no feature asserting on them: ${unclaimed.join(', ')}`);
  });
});

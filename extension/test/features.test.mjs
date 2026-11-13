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

  test('resolve prefers what the user configured, then PATH, then uvx', async () => {
    const probe = (works) => ({ works: async (argv) => works.includes(argv[0]) });
    assert.equal((await E.resolve('semlayer', probe(['semlayer']))).kind, 'path');
    assert.equal((await E.resolve('semlayer', probe(['uvx']))).kind, 'uvx');
    assert.equal((await E.resolve('semlayer', probe([]))).kind, 'install');
    // A configured command wins even when `semlayer` is on PATH: they set it
    // for a reason.
    const chosen = await E.resolve('/opt/semlayer', probe(['/opt/semlayer', 'semlayer']));
    assert.equal(chosen.kind, 'configured');
    assert.deepEqual(chosen.argv, ['/opt/semlayer']);
  });

  test('estimate — deterministic is free and labelled', () => {
    assert.equal(V.estimate(36, true).spend, '$0.00');
    assert.match(V.estimate(15000, false).spend, /^~\$\d/);
  });
});

describe('coverage', () => {
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

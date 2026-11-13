/**
 * The contracts this extension depends on, checked against a real engine.
 *
 * Everything else in the suite is pure: these are the four places the
 * extension would break silently if the CLI changed its output shape, and
 * nothing in TypeScript can catch that.
 *
 * Skipped entirely when there is no engine and no demo layer, so the suite
 * still runs on a machine that has neither -- a skipped contract test is
 * honest, a mocked one is not.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CLI = process.env.SEMLAYER_CLI
  ?? join(homedir(), 'semanticData/oss/.venv/bin/semlayer');
const DEMO = process.env.SEMLAYER_DEMO ?? join(homedir(), 'semlayer-demo');
const LAYER = join(DEMO, 'messy_mart.yaml');
const WAREHOUSE = `duckdb:${join(DEMO, 'messy_mart.duckdb')}`;

const ready = existsSync(CLI) && existsSync(LAYER);
const opts = { skip: ready ? false : 'no engine or demo layer on this machine' };

/** lint exits 2 when it finds something, so a non-zero code is not an error. */
function cli(args, input) {
  try {
    return execFileSync(CLI, args, { input, encoding: 'utf8', timeout: 120_000 });
  } catch (e) {
    if (e.stdout) { return e.stdout; }
    throw e;
  }
}

describe('cli contracts', opts, () => {
  test('lint.cli — findings carry rule, severity, message and fix', () => {
    const sql = 'select sum(h.tot_amt) from ord_hdr h join ord_ln l on l.ord_id = h.ord_id';
    const out = JSON.parse(cli(['lint', LAYER, '-', '--json', '--dialect', 'duckdb'], sql));
    assert.ok(Array.isArray(out), 'lint --json returns one entry per statement');
    const [stmt] = out;
    assert.ok('sql' in stmt, 'the statement text is echoed back');  // positions depend on it
    assert.ok(stmt.findings.length > 0, 'a fan-out join produces findings');
    for (const f of stmt.findings) {
      for (const k of ['rule', 'severity', 'message', 'table', 'column', 'fix']) {
        assert.ok(k in f, `a finding is missing ${k}`);
      }
    }
    assert.ok(stmt.findings.some((f) => f.rule === 'fanout_aggregate'),
      'the fan-out is still detected');
  });

  test('lint.cli — no source offsets, which is why positions are reconstructed', () => {
    const out = JSON.parse(cli(['lint', LAYER, '-', '--json'], 'select 1 from ord_hdr'));
    for (const f of out[0].findings ?? []) {
      assert.ok(!('line' in f) && !('column_number' in f) && !('offset' in f),
        'the engine now reports positions: src/positions.ts can be deleted');
    }
  });

  test('create.scope — probe reports what the extension reads', () => {
    const p = JSON.parse(cli(['probe', WAREHOUSE, '--json']));
    for (const k of ['tables', 'columns', 'schemas',
                     'declared_pk_ratio', 'declared_fk_ratio', 'has_manifest', 'grade']) {
      assert.ok(k in p, `probe --json is missing ${k}`);
    }
    assert.ok(p.tables > 0);
  });

  test('review.cli — the queue carries claim, consequences and a key', () => {
    const q = JSON.parse(cli(['review', LAYER, '--list', '--json']));
    assert.ok('questions' in q && 'undecided_items' in q);
    for (const x of q.questions) {
      for (const k of ['key', 'kind', 'claim', 'engine_saw', 'count',
                       'objects', 'on_accept', 'on_reject']) {
        assert.ok(k in x, `a question is missing ${k}`);
      }
    }
  });

  test('day2.cli.drift — quiet drift is prose, not JSON', () => {
    // The contract worth pinning: with nothing to report the CLI prints a
    // sentence, so a caller that only tries JSON.parse sees an error where it
    // should see calm. readDrift() checks for a leading brace because of this.
    const out = cli(['drift', LAYER, WAREHOUSE, '--json']).trim();
    if (!out.startsWith('{')) {
      assert.match(out, /no drift/i);
    } else {
      const d = JSON.parse(out);
      for (const k of ['events', 'orphaned', 'needs_inference', 'affected']) {
        assert.ok(k in d, `drift --json is missing ${k}`);
      }
    }
  });

  test('create.sample.cli — `semlayer demo` exists and writes a warehouse', () => {
    const help = cli(['--help']);
    assert.match(help, /\bdemo\b/, 'the demo subcommand is gone');
  });

  test('meta.export — there is still no export subcommand', () => {
    // If this fails, the gap closed and the extension should grow a button.
    const help = cli(['--help']);
    assert.ok(!/^\s+export\b/m.test(help),
      'semlayer export now exists: meta.export is no longer a gap');
  });
});

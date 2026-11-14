/**
 * How the extension decides to run the engine.
 *
 * The ordering here is the whole file. A walkthrough on a machine with uv
 * installed and no engine ran every call through `uvx`, because the uvx route
 * answered before the install offer was considered — so "Install the engine"
 * was never shown, and uvx served whatever environment it had cached. The
 * layer that walk produced is stamped `engine: 0.7.0b3`, built six minutes
 * after 0.7.0b4 reached PyPI.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as E from '../out/engine.js';

const HOME = '/home/u';

/** A probe where only the listed commands answer. */
const probeFor = (works) => ({
  works: async (argv) => works.some((w) => argv[0] === w),
});

describe('engine resolution', () => {
  test('an installed semlayer wins over everything', async () => {
    const r = await E.resolve('semlayer', probeFor(['semlayer', '/home/u/.local/bin/uvx']), HOME);
    assert.equal(r.kind, 'path');
    assert.deepEqual(r.argv, ['semlayer']);
  });

  test('semlayer off PATH is still found where uv puts it', async () => {
    const r = await E.resolve('', probeFor(['/home/u/.local/bin/semlayer']), HOME);
    assert.equal(r.kind, 'path');
    assert.deepEqual(r.argv, ['/home/u/.local/bin/semlayer']);
  });

  test('uv and uvx but no engine: OFFER THE INSTALL, do not route through uvx', async () => {
    // The regression this file exists for. uvx ships with uv, so this is what
    // every machine with uv looks like before the engine is installed.
    const r = await E.resolve('', probeFor(['/home/u/.local/bin/uv',
                                            '/home/u/.local/bin/uvx']), HOME);
    assert.equal(r.kind, 'install', 'must offer the one-time install');
    assert.match(r.via.command, /uv tool install/);
    assert.match(r.via.command, /semlayer\[warehouses\]/);
  });

  test('uvx without uv falls back to running through it, and says so', async () => {
    const r = await E.resolve('', probeFor(['/home/u/.local/bin/uvx']), HOME);
    assert.equal(r.kind, 'uvx', 'kind drives the first-run notice in the panel');
    assert.equal(r.argv[0], '/home/u/.local/bin/uvx');
    assert.ok(r.argv.includes('semlayer[warehouses]'));
  });

  test('nothing at all: offer the whole thing, in one step', async () => {
    const r = await E.resolve('', probeFor([]), HOME);
    assert.equal(r.kind, 'install');
    assert.equal(r.via.label, 'Install semlayer');
    assert.equal(E.stage(r), 'nothing');
  });

  test('a configured path beats every guess', async () => {
    const r = await E.resolve('/opt/semlayer', probeFor(['/opt/semlayer', 'semlayer']), HOME);
    assert.equal(r.kind, 'configured');
    assert.deepEqual(r.argv, ['/opt/semlayer']);
  });

  test('the candidate lists no longer overlap', () => {
    // `candidates` used to carry the uvx route, which is how it outranked the
    // install offer in the first place.
    const bins = E.candidates(HOME).flat().join(' ');
    assert.ok(!bins.includes('uvx'), 'engine binaries only');
    assert.ok(E.uvxCandidates(HOME).every((a) => a[0].endsWith('uvx')));
  });

  test('stage names the three states the panel has to tell apart', async () => {
    const probe = (have) => probeFor(have);
    assert.equal(E.stage(await E.resolve('', probe([]), HOME)), 'nothing');
    assert.equal(E.stage(await E.resolve('', probe(['/home/u/.local/bin/uv']), HOME)), 'uv');
    assert.equal(E.stage(await E.resolve('', probe(['semlayer']), HOME)), 'engine');
    // The middle one is the whole point: it is not an engine, and it is not
    // failure either.
    const mid = await E.resolve('', probe(['/home/u/.local/bin/uv',
                                           '/home/u/.local/bin/uvx']), HOME);
    assert.equal(E.stage(mid), 'uv');
    assert.equal(mid.via.label, E.ENGINE_LABEL);
  });

  test('a machine with nothing is asked ONCE, and gets both', async () => {
    // Two prompts were an artifact of modelling what is MISSING rather than
    // what the user came for. uv is not a thing anyone wants; an engine is.
    const b = E.offerFor(await E.resolve('', probeFor([]), HOME));
    assert.match(b.command, /astral\.sh/, 'still installs uv');
    assert.match(b.command, /tool install/, 'and the engine, in the same step');
    assert.match(b.command, /&&/, 'chained, so a failed uv does not run a missing uv');
    assert.ok(b.command.includes('"$HOME/.local/bin/uv"'),
      'absolute: the installer puts uv on the PATH of future shells, not this one');
  });

  test('the button installs what the panel is offering', async () => {
    // It ran `installers()[0]` -- always the uv bootstrap -- so pressing
    // "Install the engine" installed uv again, and uv's own script signs off
    // with "everything's installed!" while there is still no engine.
    const probe = (have) => probeFor(have);
    const bare = E.offerFor(await E.resolve('', probe([]), HOME));
    assert.match(bare.command, /astral\.sh|uv/, 'nothing installed: get uv');

    const haveUv = E.offerFor(await E.resolve('', probe(['/home/u/.local/bin/uv',
                                                        '/home/u/.local/bin/uvx']), HOME));
    assert.match(haveUv.command, /tool install/);
    assert.match(haveUv.command, /semlayer\[warehouses\]/);
    assert.ok(!haveUv.command.includes('astral.sh'),
      'uv is already here; installing it again is the bug');
    assert.equal(haveUv.label, E.ENGINE_LABEL);
  });

  test('uvx is probed with --version, never by fetching the package', async () => {
    // Probing the route itself means a 65-package download inside a ten-second
    // timeout, which fails on exactly the machine the route exists for.
    assert.deepEqual(E.probeFor(['/home/u/.local/bin/uvx', '--from', 'x', 'y']),
                     ['/home/u/.local/bin/uvx', '--version']);
  });
});

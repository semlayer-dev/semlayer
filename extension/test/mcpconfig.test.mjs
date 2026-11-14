/**
 * The MCP client config entry.
 *
 * Written after a user walked the three steps, connected Claude Code from the
 * panel, asked it a revenue question, and was told the semlayer server failed
 * to start: `executable not found`. The config the panel had just written said
 * `"command": "semlayer"`, and the engine was not on that client's PATH.
 *
 * None of the extension's 117 tests could have caught it: `mcp.ts` imports
 * `vscode`, so nothing loadable here ever touched the function that writes it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serverEntry, absolute, entryWorks } from '../out/mcpconfig.js';

/** A directory holding a file that looks like an executable. */
function binDir(name = 'semlayer') {
  const dir = mkdtempSync(join(tmpdir(), 'semlayer-mcp-'));
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return { dir, file };
}

describe('mcp config', () => {
  test('a bare command is resolved to an absolute path', () => {
    const { dir, file } = binDir();
    const e = serverEntry('/w/layer.yaml', ['semlayer'], { PATH: dir });
    assert.equal(e.command, file, 'the client gets a path, not a name to look up');
    assert.deepEqual(e.args, ['mcp', '/w/layer.yaml']);
  });

  test('the uvx route keeps its arguments as arguments', () => {
    // The whole argv used to be joined into `command`, naming an executable
    // called "uvx --python 3.13 --from semlayer[warehouses] semlayer".
    const { dir, file } = binDir('uvx');
    const argv = ['uvx', '--python', '3.13', '--from', 'semlayer[warehouses]', 'semlayer'];
    const e = serverEntry('/w/layer.yaml', argv, { PATH: dir });
    assert.equal(e.command, file);
    assert.deepEqual(e.args, ['--python', '3.13', '--from', 'semlayer[warehouses]',
                              'semlayer', 'mcp', '/w/layer.yaml']);
    assert.ok(!e.command.includes(' '), 'a command with a space in it is not a command');
  });

  test('an absolute path that exists is left alone', () => {
    const { file } = binDir();
    assert.equal(absolute(file), file);
  });

  test('an absolute path that does not exist resolves to nothing', () => {
    assert.equal(absolute('/nowhere/semlayer'), null);
    assert.equal(absolute('semlayer', { PATH: '/nowhere' }), null);
    assert.equal(absolute('', { PATH: '/nowhere' }), null);
  });

  test('an unresolvable command still writes, and reads back as not connected', () => {
    // Better a config that might work than none -- but the panel must not
    // call it a connection, because that is the claim that was false while
    // the agent sat there with no data.
    const e = serverEntry('/w/layer.yaml', ['semlayer'], { PATH: '/nowhere' });
    assert.equal(e.command, 'semlayer');
    assert.equal(entryWorks(e, { PATH: '/nowhere' }), false);
  });

  test('entryWorks judges the command, not the presence of a key', () => {
    const { dir, file } = binDir();
    assert.equal(entryWorks({ command: file }), true);
    assert.equal(entryWorks({ command: 'semlayer' }, { PATH: dir }), true);
    assert.equal(entryWorks({ command: 'semlayer' }, { PATH: '/nowhere' }), false);
    assert.equal(entryWorks({}), false);
    assert.equal(entryWorks(undefined), false);
    assert.equal(entryWorks({ command: 42 }), false);
  });
});

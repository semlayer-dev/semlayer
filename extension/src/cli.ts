/**
 * Running the semlayer CLI.
 *
 * The extension has no engine of its own: every answer comes from the same
 * `semlayer` the user runs in a terminal, invoked with `--json`. That is the
 * whole integration surface -- no MCP, no HTTP, no reimplementation of lint
 * in TypeScript that could drift from the Python one.
 */
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { splitCommand, UVX_ARGV } from './engine';

export class CliError extends Error {
  constructor(message: string, readonly code: number | null, readonly stderr: string) {
    super(message);
  }
}

/**
 * How to invoke the engine, as argv.
 *
 * A LIST, not a path, because the one route that works on a machine with no
 * Python is `uvx --from semlayer[warehouses] semlayer` -- a command plus three
 * arguments. When the setting held only a binary path, that user had a working
 * engine and no way to point us at it.
 *
 * `route` is set once the panel has worked out what this machine can run, so
 * a user who installs uv mid-session does not have to configure anything.
 */
let route: string[] | undefined;

export function setRoute(argv: string[] | undefined): void { route = argv; }

export function cliArgv(): string[] {
  const configured = vscode.workspace.getConfiguration('semlayer')
    .get<string>('cliPath')?.trim();
  if (configured && configured !== 'semlayer') { return splitCommand(configured); }
  if (route?.length) { return route; }
  return ['semlayer'];
}

/** What to show the user when naming the command. */
export function cliPath(): string { return cliArgv().join(' '); }

/** True when we are going through uvx, which is slower and worth saying so. */
export function viaUvx(): boolean { return cliArgv()[0] === UVX_ARGV[0]; }

export interface RunOptions {
  stdin?: string;
  /** Overrides the workspace folder. Rarely needed -- see `run`. */
  cwd?: string;
  /** Kills the process if it outlives this. Lint is sub-second; infer is minutes. */
  timeoutMs?: number;
  token?: vscode.CancellationToken;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * The folder the user opened, which is what every relative path in this
 * extension means.
 *
 * Without it, engine calls inherit the extension HOST's directory -- which is
 * wherever VS Code was launched from and never what the user meant. It is
 * defaulted here rather than passed per call because the bug class is
 * invisible at the call site: `semlayer discover` emits relative URIs for
 * DuckDB files it found in the working directory ("duckdb:messy_mart.duckdb"),
 * so a connection the user picked off our own list then failed to open. That
 * was fixed once, in `discover` alone, which left probe, infer, drift, review
 * and init holding the same landmine.
 */
function workspaceCwd(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function run(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const argv = cliArgv();
    const child = spawn(argv[0], [...argv.slice(1), ...args], {
      cwd: opts.cwd ?? workspaceCwd(),
      env: process.env,
      shell: false,          // never a shell: arguments are paths the user typed
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const done = (fn: () => void) => {
      if (settled) { return; }
      settled = true;
      clearTimeout(timer);
      sub?.dispose();
      fn();
    };

    const timer = opts.timeoutMs
      ? setTimeout(() => { child.kill(); done(() => reject(new CliError(
          `semlayer did not answer within ${opts.timeoutMs} ms`, null, stderr))); }, opts.timeoutMs)
      : undefined as unknown as NodeJS.Timeout;

    const sub = opts.token?.onCancellationRequested(() => {
      child.kill();
      done(() => reject(new vscode.CancellationError()));
    });

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('error', (e: NodeJS.ErrnoException) => done(() => {
      // ENOENT is the only failure worth a tailored message: it is what a
      // missing install looks like, and it is the most likely first-run state.
      reject(e.code === 'ENOENT'
        ? new CliError(`'${cliArgv()[0]}' was not found on your PATH.`, null, String(e))
        : new CliError(e.message, null, String(e)));
    }));

    child.on('close', (code) => done(() => resolve({ code, stdout, stderr })));

    if (opts.stdin !== undefined) {
      child.stdin.on('error', () => { /* the child exited first; `close` reports it */ });
      child.stdin.end(opts.stdin);
    } else {
      child.stdin.end();
    }
  });
}

/** Run and parse `--json` output. Non-zero exit is NOT an error: lint exits 1 on findings. */
export async function runJson<T>(args: string[], opts: RunOptions = {}): Promise<T> {
  const { stdout, stderr, code } = await run(args, opts);
  const text = stdout.trim();
  if (!text) {
    throw new CliError(`semlayer ${args[0]} produced no output`, code, stderr);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CliError(`semlayer ${args[0]} did not return JSON`, code, stderr || text.slice(0, 400));
  }
}

/** Version string, or null when the CLI is missing or unrunnable. */
export async function version(): Promise<string | null> {
  try {
    const { stdout, code } = await run(['--help'], { timeoutMs: 10_000 });
    return code === 0 ? (stdout.split('\n')[0] || 'semlayer').trim() : null;
  } catch {
    return null;
  }
}

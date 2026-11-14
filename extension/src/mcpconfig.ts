/**
 * What goes into an MCP client's config, as pure functions.
 *
 * Separate from `mcp.ts` because that file imports `vscode` and so cannot be
 * loaded outside an extension host -- which is why the two bugs below shipped
 * with no test able to see them. Everything here takes its inputs as
 * arguments and touches nothing but the filesystem it is asked about.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ServerEntry {
  command: string;
  args: string[];
}

/**
 * The `mcpServers.semlayer` entry, built from however this machine runs the
 * engine.
 *
 * Two bugs lived in the one line this replaces, and a user hit both in one
 * evening: the client reported `executable not found`, and the agent answered
 * a revenue question by saying it had no data.
 *
 * 1. `command` was the whole argv joined with spaces. For a plain binary that
 *    happens to work; for the uvx route it writes
 *    `"uvx --python 3.13 --from semlayer[warehouses] semlayer"` as the name of
 *    an executable, which cannot exist. Command and arguments are separate
 *    fields in every client's schema and have to stay that way.
 *
 * 2. A bare `semlayer` was written whenever the panel had not resolved a route
 *    yet -- the value `cliArgv()` falls back to. The client is a DIFFERENT
 *    process with a different environment: an app launched from a dock never
 *    sees the shell's PATH, and `~/.local/bin` is exactly the directory that
 *    goes missing. An absolute path is the only form that survives the trip.
 */
export function serverEntry(layerPath: string, argv: string[],
                            env = process.env): ServerEntry {
  const [head, ...rest] = argv;
  return {
    // Falling back to the bare name when it cannot be resolved is deliberate:
    // a config that might work beats no config, and `stateOf` reports it as
    // unconfigured so the panel offers to write it again.
    command: absolute(head, env) ?? head,
    args: [...rest, 'mcp', layerPath],
  };
}

/** Resolve a bare command against PATH. An absolute path passes through if it exists. */
export function absolute(cmd: string, env = process.env): string | null {
  if (!cmd) { return null; }
  if (cmd.includes('/') || cmd.includes(path.sep)) {
    return fs.existsSync(cmd) ? cmd : null;
  }
  const exts = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) { continue; }
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      if (fs.existsSync(full)) { return full; }
    }
  }
  return null;
}

/**
 * Whether a config entry we find names something runnable.
 *
 * The question `stateOf` needs, and the one it did not ask: it reported any
 * `semlayer` key as a connection, including one naming a command that is not
 * on this machine -- which is what "configured" said right up to the moment
 * the agent reported no data.
 */
export function entryWorks(entry: unknown, env = process.env): boolean {
  const cmd = (entry as { command?: unknown } | undefined)?.command;
  if (typeof cmd !== 'string') { return false; }
  return absolute(cmd, env) !== null;
}

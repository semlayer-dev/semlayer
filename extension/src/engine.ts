/**
 * Finding an engine on a machine that may have nothing.
 *
 * The extension is 36KB of JavaScript and the engine is Python with warehouse
 * drivers, so bundling is not an option and some install is unavoidable. What
 * IS avoidable is assuming the user already has Python: a VS Code user may
 * have no python, no pip, no pipx and no uv, and the first version of this
 * panel told every one of them `pipx install semlayer` and stopped.
 *
 * `uv` is the floor. It is a single static binary that installs its own
 * Python, so it is the only bootstrap that works from nothing, and `uvx` then
 * fetches semlayer on first use -- which is already what docs/mcp.md tells
 * MCP users to do. Measured here: 13.8s on the first fetch, then 0.32s per
 * invocation against 0.21s for a direct install.
 */
/** How we would run the engine, in descending order of how nice it is. */
export type Route =
  | { kind: 'path'; argv: string[] }        // `semlayer` is on PATH
  | { kind: 'configured'; argv: string[] }  // the user set semlayer.cliPath
  | { kind: 'uvx'; argv: string[] }         // uvx is here; no install needed
  | { kind: 'install'; via: Installer }     // nothing usable; offer a bootstrap
  ;

export interface Installer {
  /** What the user ends up with. */
  label: string;
  /** Shown in full before it runs. We never hide a command we are asking for. */
  command: string;
  /** Why this one and not another. */
  note: string;
}

/**
 * The bootstrap offered per platform, and alternatives for anyone whose
 * organisation blocks piping a script into a shell -- a fair objection, and
 * one we should answer rather than argue with.
 */
export function installers(platform = process.platform): Installer[] {
  const uvWindows: Installer = {
    label: 'Install uv',
    command: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
    note: 'A single binary. It brings its own Python, so nothing else is needed.',
  };
  const uvUnix: Installer = {
    label: 'Install uv',
    command: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
    note: 'A single binary. It brings its own Python, so nothing else is needed.',
  };
  const list: Installer[] = [platform === 'win32' ? uvWindows : uvUnix];

  if (platform === 'darwin') {
    list.push({ label: 'Homebrew', command: 'brew install uv',
                note: 'The same binary, if you would rather not pipe a script into a shell.' });
  }
  if (platform === 'win32') {
    list.push({ label: 'winget', command: 'winget install --id=astral-sh.uv -e',
                note: 'The same binary, if you would rather not run a script from the web.' });
  }
  // Both Python routes, at equal weight. Burying pip in a footnote to the
  // pipx line was a dead end for anyone who has pip and not pipx -- which is
  // most people with Python, since pipx is itself an extra install.
  list.push({
    label: 'With pip',
    command: 'pip install --user "semlayer[warehouses]"',
    note: 'If you already have Python. Installs into your user site-packages.',
  });
  list.push({
    label: 'With pipx',
    command: 'pipx install "semlayer[warehouses]"',
    note: 'Also needs Python, but keeps semlayer in its own environment so its '
        + 'dependencies cannot collide with anything else you have installed.',
  });
  return list;
}

/**
 * The configured path, split so it can carry arguments.
 *
 * `uvx --from "semlayer[warehouses]" semlayer` is a command AND arguments, and
 * a setting that holds only a binary path cannot express it -- which left the
 * one user who needs it most, the one with no Python, with a working engine
 * and no way to point us at it. Quoted segments are kept whole so a path with
 * a space still works.
 */
export function splitCommand(raw: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/**
 * The uvx invocation.
 *
 * `--from` because the extras are not in the script name.
 *
 * `--python 3.13` is NOT optional, and leaving it out is a real failure we
 * reproduced: on a machine with no Python at all, uv downloads the NEWEST
 * CPython -- 3.15 at the time of writing -- and `duckdb` publishes wheels
 * only up to cp314. With no wheel it builds from source, wants CMake, and
 * dies after two and a half minutes. That is precisely the machine this
 * route exists for, so the unpinned form fails exactly the user it is meant
 * to serve.
 *
 * It can be raised, or dropped, once every dependency ships wheels for the
 * Python uv would otherwise pick. Until then the pin is what makes this work
 * from nothing: measured 4.7s to install uv, then a first fetch, then 0.28s
 * per call.
 */
export const UVX_PYTHON = '3.13';
export const UVX_ARGV = [
  'uvx', '--python', UVX_PYTHON, '--from', 'semlayer[warehouses]', 'semlayer'];

/**
 * Where these things land, for the case PATH will not cover.
 *
 * uv's installer ends by saying: "To add $HOME/.local/bin to your PATH,
 * either restart your shell or run: source $HOME/.local/bin/env". A shell
 * restart does not help us -- the extension host inherited its environment
 * when VS Code started, and reloading the window does not re-read the user's
 * profile. So a user can follow our instructions exactly, watch uv install
 * successfully, and still be told there is no engine.
 *
 * Looking in the known locations costs one stat per candidate and removes
 * that entire class of "it says it installed but you still cannot see it".
 */
export function candidates(home: string, platform = process.platform): string[][] {
  const exe = platform === 'win32' ? '.exe' : '';
  const sep = platform === 'win32' ? '\\' : '/';
  const join = (...parts: string[]) => parts.join(sep);

  const uvHomes = [join(home, '.local', 'bin'), join(home, '.cargo', 'bin')];
  const out: string[][] = [];

  // A direct install of semlayer first -- it is faster than going through uvx.
  for (const dir of uvHomes) {
    out.push([join(dir, `semlayer${exe}`)]);
  }
  for (const dir of uvHomes) {
    out.push([join(dir, `uvx${exe}`), ...UVX_ARGV.slice(1)]);
  }
  return out;
}

export interface Probe {
  /** Does this command answer at all? */
  works(argv: string[]): Promise<boolean>;
}

/**
 * What to RUN to find out whether a route is usable.
 *
 * Deliberately not the route itself. Probing the uvx route by running
 * `uvx ... semlayer --help` means fetching Python and sixty-five packages on
 * a machine that has neither -- minutes of work behind a ten-second timeout,
 * so the probe failed in exactly the situation the route exists for, and the
 * panel said "still no engine" while uvx sat on the PATH.
 *
 * The launcher answering is the question. Whether the package is cached yet
 * is not: it will be, on first use.
 */
export function probeFor(argv: string[]): string[] {
  const head = argv[0];
  const base = head.replace(/\\/g, '/').split('/').pop() ?? head;
  if (base === 'uvx' || base === 'uvx.exe') { return [head, '--version']; }
  return [...argv, '--help'];
}

/**
 * Decide how to run the engine, given what answers on this machine.
 *
 * Order matters: a path the user configured wins over anything we guess,
 * because they configured it for a reason.
 */
export async function resolve(configured: string, probe: Probe,
                              home = ''): Promise<Route> {
  const raw = configured.trim();
  if (raw && raw !== 'semlayer') {
    const argv = splitCommand(raw);
    if (await probe.works(probeFor(argv))) { return { kind: 'configured', argv }; }
  }
  if (await probe.works(probeFor(['semlayer']))) {
    return { kind: 'path', argv: ['semlayer'] };
  }
  if (await probe.works(probeFor(UVX_ARGV))) { return { kind: 'uvx', argv: UVX_ARGV }; }

  // Not on PATH, which does NOT mean not installed. See `candidates`.
  for (const argv of candidates(home)) {
    if (await probe.works(probeFor(argv))) {
      return argv[0].endsWith('uvx') || argv[0].endsWith('uvx.exe')
        ? { kind: 'uvx', argv }
        : { kind: 'path', argv };
    }
  }
  return { kind: 'install', via: installers()[0] };
}

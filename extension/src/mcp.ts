/**
 * Writing an MCP client's config.
 *
 * Hand-editing a JSON config is the step that loses people, and it is the step
 * an extension can simply do: we already know the layer path and where the
 * binary is. Every client below takes the same `mcpServers` shape; only the
 * file differs.
 */
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { cliArgv } from './cli';
import { entryWorks, serverEntry } from './mcpconfig';

export interface Client {
  id: string;
  label: string;
  file: string;
}

function home(...parts: string[]): string { return path.join(os.homedir(), ...parts); }

export function clients(): Client[] {
  const list: Client[] = [
    { id: 'claude-code', label: 'Claude Code', file: home('.claude.json') },
    { id: 'cline', label: 'Cline', file: home('.cline', 'data', 'settings', 'cline_mcp_settings.json') },
    { id: 'cursor', label: 'Cursor', file: home('.cursor', 'mcp.json') },
  ];
  // Claude Desktop keeps its config somewhere different on every platform.
  const desktop = process.platform === 'darwin'
    ? home('Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA ?? home('AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
      : home('.config', 'Claude', 'claude_desktop_config.json');
  list.push({ id: 'claude-desktop', label: 'Claude Desktop', file: desktop });
  return list;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
    const text = Buffer.from(bytes).toString('utf8').trim();
    return text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    return {};   // absent or unreadable: we are about to write it
  }
}

/**
 * What we can actually tell about a client, which is less than it looks.
 *
 *   absent     no config file -- the client has probably never run here
 *   present    a config file, but no semlayer entry in it
 *   configured its config names semlayer
 *
 * Note what is NOT here: whether the client is installed, running, or will
 * ever read this file. An earlier version called `configured` "connected",
 * which was wrong in a way a user caught immediately -- a config left behind
 * by a client that is no longer installed reported as a live connection.
 */
export type ClientState = 'absent' | 'present' | 'configured';

export async function stateOf(client: Client): Promise<ClientState> {
  let raw: Uint8Array;
  try {
    raw = await vscode.workspace.fs.readFile(vscode.Uri.file(client.file));
  } catch {
    return 'absent';
  }
  try {
    const text = Buffer.from(raw).toString('utf8').trim();
    const cfg = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    const servers = cfg.mcpServers as Record<string, unknown> | undefined;
    if (!servers || !('semlayer' in servers)) { return 'present'; }
    // An entry naming a command that is not on this machine is not a
    // connection. One was written with a bare `semlayer` while the engine
    // lived somewhere the client could not see, and this reported it as
    // connected right up to the moment the agent said it had no data.
    // Reporting it as `present` is what puts "Connect Claude Code" back in
    // the panel, and that button rewrites the entry correctly.
    return entryWorks(servers.semlayer) ? 'configured' : 'present';
  } catch {
    return 'present';   // unreadable JSON is still a client that exists
  }
}

/**
 * Merge our entry in, leaving every other server and every unrelated key
 * alone. A client config is the user's file, not ours: we add one key to it.
 */
export async function configure(client: Client, layer: vscode.Uri): Promise<void> {
  const cfg = await readJson(client.file);
  const servers = (cfg.mcpServers ?? {}) as Record<string, unknown>;

  servers.semlayer = serverEntry(layer.fsPath, cliArgv());
  cfg.mcpServers = servers;

  const uri = vscode.Uri.file(client.file);
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(client.file)));
  await vscode.workspace.fs.writeFile(
    uri, Buffer.from(JSON.stringify(cfg, null, 2) + '\n', 'utf8'));
}

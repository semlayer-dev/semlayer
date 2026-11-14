/**
 * Finding the semantic layer document a workspace holds.
 *
 * A semantic layer is a YAML file with a `semantic_layer:` key and a
 * `spec_version`. Workspaces are full of YAML that is not ours, so the test is
 * on content and deliberately cheap: read the head of the file, not all of it.
 */
import * as vscode from 'vscode';
import { countTables, layerName, layerWarehouse } from './yaml';

const HEAD_BYTES = 4096;

export interface Layer {
  uri: vscode.Uri;
  name: string;
  tables: number | null;   // null when the document has no tables block
  /** The source it was inferred from, as the document records it. */
  warehouse: string | null;
}

function looksLikeLayer(head: string): boolean {
  return /^\s*semantic_layer\s*:/m.test(head) || /^\s*spec_version\s*:/m.test(head);
}

async function describe(uri: vscode.Uri): Promise<Layer | null> {
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch {
    return null;
  }
  const head = Buffer.from(bytes.slice(0, HEAD_BYTES)).toString('utf8');
  if (!looksLikeLayer(head)) { return null; }

  const text = Buffer.from(bytes).toString('utf8');
  const name = layerName(text)
    ?? uri.path.split('/').pop()!.replace(/\.ya?ml$/, '');
  const tables = countTables(text);
  return { uri, name, tables, warehouse: layerWarehouse(text) };
}

/** Every layer in the workspace, nearest the root first. */
export async function discover(max = 20): Promise<Layer[]> {
  const found = await vscode.workspace.findFiles(
    '**/*.{yaml,yml}', '**/{node_modules,.git,dist,build,target,.venv}/**', 200);
  const sorted = found.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const out: Layer[] = [];
  for (const uri of sorted) {
    const layer = await describe(uri);
    if (layer) { out.push(layer); }
    if (out.length >= max) { break; }
  }
  return out;
}

/**
 * The layer to lint against: the configured one if set, else the first found.
 * Cached, because this runs on every keystroke and `findFiles` does not belong
 * in that path.
 */
let cached: { value: Layer | undefined; at: number } | undefined;
const TTL_MS = 30_000;

export function invalidate(): void { cached = undefined; }

/**
 * Wait for a layer to show up in the workspace, briefly.
 *
 * `findFiles` reads VS Code's own file index, which lags a file created
 * seconds ago by an external process -- which is exactly what a finished
 * inference is. Without this the panel refreshed on success, found nothing,
 * and fell back to "connect a warehouse" while the layer it had just written
 * sat on disk beside it.
 */
export async function waitForLayer(timeoutMs = 5_000): Promise<Layer | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    invalidate();
    const found = (await discover(1))[0];
    if (found || Date.now() > deadline) { return found; }
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function active(): Promise<Layer | undefined> {
  const configured = vscode.workspace.getConfiguration('semlayer').get<string>('layerPath');
  if (configured) {
    const uri = vscode.Uri.file(configured);
    return (await describe(uri)) ?? undefined;
  }
  if (cached && Date.now() - cached.at < TTL_MS) { return cached.value; }
  const value = (await discover(1))[0];
  cached = { value, at: Date.now() };
  return value;
}

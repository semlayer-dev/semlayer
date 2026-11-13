/**
 * Every webview's HTML, as pure functions.
 *
 * Nothing here imports `vscode`, and that is the point: these can be called
 * from `node --test`, rendered into a file and screenshotted headlessly. Three
 * visual bugs in this extension's first day -- buttons that rendered as plain
 * text, a table count of 318, and a paragraph of implementation notes shown to
 * the user -- all reached a human because the only way to see a view was to
 * install the extension and look. `test/render.test.mjs` and
 * `scripts/shoot.mjs` exist so that stops being true.
 */

// ---------------------------------------------------------------------------
// shared
// ---------------------------------------------------------------------------

export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Plural that reads correctly at one, which "1 tables" does not. */
export const plural = (n: number, word: string): string =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

const CSS = `
  body{margin:0;font:13px/1.45 var(--vscode-font-family);
       color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}
  .pad{padding:10px 12px}
  h2{font-size:17px;font-weight:600;margin:6px 0 0;line-height:1.35}
  h3{font-size:11px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;
     opacity:.75;margin:14px 0 6px;padding:0 12px}
  p{margin:6px 0;color:var(--vscode-descriptionForeground)}
  /* Two affordances, and they must not be confusable: a FILLED button does
     something, grey text does nothing. The secondary button style is
     deliberately unused -- VS Code's is #313131 on a #181818 sidebar, which
     reads as centred plain text rather than as a control. */
  button{width:100%;padding:5px 10px;border:0;border-radius:2px;cursor:pointer;
         background:var(--vscode-button-background, #0078d4);
         color:var(--vscode-button-foreground, #ffffff);
         font:inherit;margin-top:8px;text-align:center}
  button:hover{background:var(--vscode-button-hoverBackground, #026ec1)}
  button:disabled{opacity:.5;cursor:default}
  button.wide{width:auto;padding:5px 14px;margin:0}
  /* A third affordance, for the sidebar only: four stacked full-width blue
     slabs read as a wall rather than as choices. An outline button is still
     unmistakably a control -- the thing the secondary style failed at -- while
     letting one action per section carry the fill. */
  button.outline{background:transparent;border:1px solid var(--vscode-button-background, #0078d4);
                 color:var(--vscode-button-background, #0078d4)}
  button.outline:hover{background:var(--vscode-button-background, #0078d4);
                       color:var(--vscode-button-foreground, #ffffff)}
  .row{display:flex;gap:7px;align-items:baseline;padding:4px 12px}
  .row.act{cursor:pointer}
  .row.act:hover{background:var(--vscode-list-hoverBackground, #2a2d2e)}
  .row .t{flex:1;min-width:0}
  .dim{color:var(--vscode-descriptionForeground);font-size:12px}
  .mark{width:13px;flex:none;opacity:.8}
  .ok{color:var(--vscode-charts-green, #89d185)}
  .warn{color:var(--vscode-editorWarning-foreground, #cca700)}
  .bad{color:var(--vscode-editorError-foreground, #f14c4c)}
  code,.mono{font-family:var(--vscode-editor-font-family);font-size:12px}
  pre{background:var(--vscode-textCodeBlock-background, #1f1f1f);
      border:1px solid var(--vscode-panel-border, #2b2b2b);border-radius:2px;
      padding:8px 10px;margin:8px 0;overflow-x:auto;
      font:12px/1.5 var(--vscode-editor-font-family);white-space:pre-wrap}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;
     color:var(--vscode-descriptionForeground);padding:5px 8px;font-weight:500;
     border-bottom:1px solid var(--vscode-panel-border, #2b2b2b)}
  td{padding:5px 8px;border-bottom:1px solid var(--vscode-panel-border, #2b2b2b)}
  td.num{text-align:right;font-family:var(--vscode-editor-font-family)}
  label{display:flex;gap:8px;align-items:flex-start;padding:5px 0;cursor:pointer}
  label input{margin-top:2px;flex:none}
  select,input[type=text]{width:100%;padding:3px 6px;font:inherit;border-radius:2px;
    background:var(--vscode-input-background, #313131);
    color:var(--vscode-input-foreground, #cccccc);
    border:1px solid var(--vscode-input-border, #3c3c3c)}
  fieldset{border:0;border-top:1px solid var(--vscode-panel-border, #2b2b2b);
           margin:14px 0 0;padding:10px 0 0}
  legend{font-size:11px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;
         opacity:.75;padding:0}
  .note{border-left:2px solid var(--vscode-textLink-foreground, #4daafc);
        padding:2px 0 2px 10px;margin:10px 0;color:var(--vscode-descriptionForeground);
        font-size:12px}
  .warnbox{border-left:2px solid var(--vscode-editorWarning-foreground, #cca700);
        padding:2px 0 2px 10px;margin:10px 0;color:var(--vscode-descriptionForeground);
        font-size:12px}
  .big{font-size:15px;font-weight:600}
`;

/** Document shell. `wide` views sit in an editor tab and use its background. */
export function shell(body: string, opts: { wide?: boolean; script?: string } = {}): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>${CSS}${opts.wide
  ? '\n  body{background:var(--vscode-editor-background)}\n  .pad{padding:16px 22px}' : ''}
</style></head><body>${body}
<script>
  const vs = acquireVsCodeApi();
  const post = (m) => vs.postMessage(m);
  document.querySelectorAll('[data-cmd]').forEach((el) =>
    el.addEventListener('click', () => post({ command: el.dataset.cmd })));
  document.querySelectorAll('[data-msg]').forEach((el) =>
    el.addEventListener('click', () => post(JSON.parse(el.dataset.msg))));
  ${opts.script ?? ''}
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

/**
 * Every field maps to a real `semlayer infer` flag. There is deliberately no
 * model picker: the model is a constant in the engine (claude-haiku-4-5) with
 * no flag and no environment override, so a dropdown here would be a control
 * over nothing. The real choice is a model or no model, which is `--no-llm`.
 */
export interface Settings {
  noLlm: boolean;
  noSampleEgress: boolean;
  noLlmCache: boolean;
  noDeclaredConstraints: boolean;
  llmWorkers: number;
  queryWorkers: number | null;
  schema: string;
  name: string;
  manifest: string;
  context: string[];
  openPr: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  noLlm: false, noSampleEgress: false, noLlmCache: false, noDeclaredConstraints: false,
  llmWorkers: 4, queryWorkers: null, schema: '', name: '', manifest: '', context: [],
  openPr: false,
};

/** Settings -> argv. The single place that knows the flag spellings. */
export function settingsToArgs(s: Settings): string[] {
  const a: string[] = [];
  if (s.noLlm) { a.push('--no-llm'); }
  if (s.noSampleEgress) { a.push('--no-sample-egress'); }
  if (s.noLlmCache) { a.push('--no-llm-cache'); }
  if (s.noDeclaredConstraints) { a.push('--no-declared-constraints'); }
  if (s.llmWorkers !== 4) { a.push('--llm-workers', String(s.llmWorkers)); }
  if (s.queryWorkers !== null) { a.push('--query-workers', String(s.queryWorkers)); }
  if (s.schema.trim()) { a.push('--schema', s.schema.trim()); }
  if (s.name.trim()) { a.push('--name', s.name.trim()); }
  if (s.manifest.trim()) { a.push('--manifest', s.manifest.trim()); }
  for (const c of s.context) { if (c.trim()) { a.push('--context', c.trim()); } }
  return a;
}

const check = (id: keyof Settings, on: boolean, title: string, why: string) => `
  <label><input type="checkbox" data-set="${id}" ${on ? 'checked' : ''}>
    <span><b>${esc(title)}</b><br><span class="dim">${why}</span></span></label>`;

export function renderSettings(s: Settings, source: string): string {
  return shell(`<div class="pad">
    <h2>Inference settings</h2>
    <p>Applied to <span class="mono">${esc(source)}</span>. Nothing runs until you press Create.</p>

    <fieldset><legend>Cost</legend>
      ${check('noLlm', s.noLlm, 'Deterministic only, no model',
        'Free and fast. Keys, types, relationships and metrics still come out; descriptions do not.')}
      <label style="display:block"><span class="dim">Model calls at once</span>
        <input type="text" data-set="llmWorkers" value="${s.llmWorkers}">
        <span class="dim">Output is identical at any value; only wall-clock changes.</span></label>
      ${check('noLlmCache', s.noLlmCache, 'Do not cache model responses on disk',
        'The cache is what makes an interrupted run cheap to resume.')}
    </fieldset>

    <fieldset><legend>Privacy</legend>
      ${check('noSampleEgress', s.noSampleEgress, 'Never send cell values to the model',
        'Column values improve typing and descriptions. Some organisations cannot send them. ' +
        'Measured across seven fixtures the accuracy cost is about zero on average, and it ' +
        'trades either way per warehouse.')}
    </fieldset>

    <fieldset><legend>Scope</legend>
      <label style="display:block"><span class="dim">Only this schema</span>
        <input type="text" data-set="schema" value="${esc(s.schema)}" placeholder="finance">
        <span class="dim">Scoping to one schema also names the document, which is the
        identity other teams reference when layers are stitched into a hub.</span></label>
      <label style="display:block"><span class="dim">Document name</span>
        <input type="text" data-set="name" value="${esc(s.name)}" placeholder="(from the schema or warehouse)"></label>
      ${check('noDeclaredConstraints', s.noDeclaredConstraints,
        'Ignore declared keys and infer them',
        'How our published accuracy is measured.')}
    </fieldset>

    <fieldset><legend>Priors</legend>
      <label style="display:block"><span class="dim">dbt manifest</span>
        <input type="text" data-set="manifest" value="${esc(s.manifest)}" placeholder="target/manifest.json">
        <span class="dim">How the tables were authored.</span></label>
      <label style="display:block"><span class="dim">Knowledge docs</span>
        <input type="text" data-set="context" value="${esc(s.context.join(', '))}"
               placeholder="./docs, ./CLAUDE.md">
        <span class="dim">Data dictionaries and wiki exports, comma separated. Their text IS
        sent to the model. Docs never override data: contradictions go to review.</span></label>
    </fieldset>

    <fieldset><legend>Output</legend>
      ${check('openPr', s.openPr, 'Open a pull request when I am done reviewing',
        'How the rest of the team ever sees this.')}
      <p class="dim">The file is written locally either way.</p>
    </fieldset>

    <div style="display:flex;gap:8px;margin:18px 0 6px">
      <button class="wide" data-msg='{"type":"create"}'>Create semantic layer</button>
      <button class="wide" data-msg='{"type":"close"}'
              style="background:var(--vscode-button-secondaryBackground,#313131);
                     color:var(--vscode-button-secondaryForeground,#cccccc)">Cancel</button>
    </div>
    <pre id="cmd">semlayer infer ${esc(source)}</pre>
  </div>`, { wide: true, script: `
    const state = ${JSON.stringify(s)};
    const cmd = () => {
      const a = [];
      if (state.noLlm) a.push('--no-llm');
      if (state.noSampleEgress) a.push('--no-sample-egress');
      if (state.noLlmCache) a.push('--no-llm-cache');
      if (state.noDeclaredConstraints) a.push('--no-declared-constraints');
      if (+state.llmWorkers !== 4) a.push('--llm-workers', state.llmWorkers);
      if (state.schema) a.push('--schema', state.schema);
      if (state.name) a.push('--name', state.name);
      if (state.manifest) a.push('--manifest', state.manifest);
      (state.context || []).filter(Boolean).forEach((c) => a.push('--context', c.trim()));
      document.getElementById('cmd').textContent =
        'semlayer infer ${esc(source)} ' + a.join(' ');
    };
    document.querySelectorAll('[data-set]').forEach((el) => {
      el.addEventListener('input', () => {
        const k = el.dataset.set;
        state[k] = el.type === 'checkbox' ? el.checked
                 : k === 'context' ? el.value.split(',')
                 : el.value;
        cmd();
        post({ type: 'settings', state });
      });
    });
    cmd();
  ` });
}

// ---------------------------------------------------------------------------
// scope: what probe found, and what it will cost
// ---------------------------------------------------------------------------

/** The subset of `semlayer probe --json` this screen reads. */
export interface Probe {
  tables: number;
  columns: number;
  schemas: number;
  declared_pk_ratio: number;
  declared_fk_ratio: number;
  has_manifest: boolean;
  grade: string;
}

/**
 * Cost and wall-clock, from the published cost model: about $0.70 per 100
 * tables end to end on the cheap tier. Labelled an estimate wherever it is
 * shown, because it is one -- it does not know how wide the tables are, nor
 * how much of the typing resolves from statistics without a model call.
 */
export function estimate(tables: number, noLlm: boolean): { spend: string; wall: string } {
  if (noLlm) {
    return { spend: '$0.00', wall: tables < 100 ? 'seconds' : 'a few minutes' };
  }
  const dollars = tables * 0.007;
  return {
    spend: dollars < 0.01 ? '<$0.01' : `~$${dollars.toFixed(dollars < 10 ? 2 : 0)}`,
    wall: tables < 50 ? 'about a minute' : tables < 500 ? 'a few minutes' : 'under ten minutes',
  };
}

const GRADE: Record<string, { label: string; cls: string; why: string }> = {
  strong: { label: 'strong', cls: 'ok', why: 'Declared keys and consistent naming.' },
  fair: { label: 'fair', cls: 'warn', why: 'Some signals are missing; expect more review questions.' },
  weak: {
    label: 'weak', cls: 'bad',
    why: 'Few declared keys. Linking will come from statistics and naming, which is how our published accuracy is measured.',
  },
};

export function renderScope(p: Probe, source: string, s: Settings): string {
  const e = estimate(p.tables, s.noLlm);
  const g = GRADE[p.grade] ?? GRADE.fair;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return shell(`<div class="pad">
    <h2>${plural(p.tables, 'table')} found</h2>
    <p><span class="mono">${esc(source)}</span></p>

    <div class="big" style="margin:14px 0 2px">${e.wall} &middot; ${e.spend}
      <span class="dim" style="font-size:12px;font-weight:400">estimated</span></div>
    <p class="dim" style="margin-top:0">Nothing has been read or spent yet.</p>

    <table style="margin-top:14px"><tbody>
      <tr><td>Tables</td><td class="num">${p.tables.toLocaleString()}</td></tr>
      <tr><td>Columns</td><td class="num">${p.columns.toLocaleString()}</td></tr>
      <tr><td>Schemas</td><td class="num">${p.schemas.toLocaleString()}</td></tr>
      <tr><td>Declared primary keys</td><td class="num">${pct(p.declared_pk_ratio)}</td></tr>
      <tr><td>Declared foreign keys</td><td class="num">${pct(p.declared_fk_ratio)}</td></tr>
      <tr><td>dbt manifest</td><td class="num">${p.has_manifest ? 'found' : 'none'}</td></tr>
    </tbody></table>

    <p style="margin-top:14px">Evidence here is
      <b class="${g.cls}">${esc(g.label)}</b>. ${esc(g.why)}</p>

    ${s.noLlm ? '<div class="note">Deterministic mode: free, and no descriptions are written. Keys, types, relationships and metrics still come out.</div>' : ''}

    <div style="display:flex;gap:8px;margin:18px 0 6px">
      <button class="wide" data-msg='{"type":"create"}'>Create semantic layer</button>
      <button class="wide" data-msg='{"type":"settings"}'
              style="background:var(--vscode-button-secondaryBackground,#313131);
                     color:var(--vscode-button-secondaryForeground,#cccccc)">Settings</button>
    </div>
  </div>`, { wide: true });
}

// ---------------------------------------------------------------------------
// grants: what `semlayer init` rendered, per warehouse family
// ---------------------------------------------------------------------------

export function renderGrants(family: string, script: string | null): string {
  if (family === 'duckdb') {
    return shell(`<div class="pad">
      <h2>No grants needed</h2>
      <p>A DuckDB file has no roles and no permissions. semlayer opens it read-only
      and never writes to it.</p>
    </div>`, { wide: true });
  }
  const isGcloud = family === 'bigquery';
  return shell(`<div class="pad">
    <h2>Minimal read-only access</h2>
    <p>${isGcloud
      ? 'IAM bindings for your project. Not SQL &mdash; these are gcloud commands.'
      : 'Hand this to whoever administers the warehouse. It grants reading, and nothing else.'}</p>
    <pre>${esc(script ?? '(semlayer init produced no script for this warehouse)')}</pre>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="wide" data-msg='{"type":"copy"}'>Copy</button>
      <button class="wide" data-msg='{"type":"save"}'
              style="background:var(--vscode-button-secondaryBackground,#313131);
                     color:var(--vscode-button-secondaryForeground,#cccccc)">Save as a file</button>
    </div>
  </div>`, { wide: true });
}

// ---------------------------------------------------------------------------
// drift
// ---------------------------------------------------------------------------

export interface DriftEvent { kind: string; table: string; column: string | null; detail: string }

export interface Drift {
  events: DriftEvent[];
  orphaned: unknown[];
  needs_inference: string[];
  affected: string[];
  broken_cqs: unknown[];
}

/**
 * One line for the sidebar. `semlayer drift --json` prints the plain sentence
 * "no drift detected" rather than JSON when there is nothing to report, so a
 * caller that only tries `JSON.parse` sees an error where it should see calm.
 */
export function driftLine(d: Drift | null): string | null {
  if (!d || !d.events.length) { return null; }
  const by = (k: string) => d.events.filter((e) => e.kind.startsWith(k)).length;
  const bits: string[] = [];
  const added = by('table_added');
  const removed = by('table_removed');
  const cols = d.events.filter((e) => e.kind.startsWith('column')).length;
  if (added) { bits.push(`${plural(added, 'new table')}`); }
  if (removed) { bits.push(`${removed} removed`); }
  if (cols) { bits.push(`${plural(cols, 'column change')}`); }
  if (!bits.length) { bits.push(plural(d.events.length, 'change')); }
  return bits.join(', ');
}

const DRIFT_LABEL: Record<string, string> = {
  table_added: 'new table',
  table_removed: 'table gone',
  column_added: 'new column',
  column_removed: 'column gone',
  column_type_changed: 'type changed',
};

export function renderDrift(d: Drift, doc: string): string {
  return shell(`<div class="pad">
    <h2>${plural(d.events.length, 'change')} since this layer was built</h2>
    <p><span class="mono">${esc(doc)}</span></p>

    <table style="margin-top:14px">
      <thead><tr><th>What</th><th>Where</th><th>Detail</th></tr></thead>
      <tbody>${d.events.slice(0, 40).map((e) => `
        <tr><td>${esc(DRIFT_LABEL[e.kind] ?? e.kind.replace(/_/g, ' '))}</td>
            <td class="mono">${esc(e.table)}${e.column ? `.${esc(e.column)}` : ''}</td>
            <td class="dim">${esc(e.detail)}</td></tr>`).join('')}
      </tbody>
    </table>
    ${d.events.length > 40 ? `<p class="dim">Showing 40 of ${d.events.length}.</p>` : ''}

    ${d.affected.length ? `<div class="warnbox"><b>${plural(d.affected.length, 'element')}</b>
      in the layer depend on what changed: ${
        esc(d.affected.slice(0, 6).join(', '))}${d.affected.length > 6 ? '&hellip;' : ''}</div>` : ''}

    ${d.orphaned.length ? `<div class="warnbox">${plural(d.orphaned.length, 'element')}
      no longer exist in the warehouse. Re-inference marks them orphaned rather than
      deleting them.</div>` : ''}

    <p style="margin-top:14px">Re-inference touches only the
    ${plural(d.needs_inference.length, 'table')} that changed and re-asks only the
    questions they changed. Verdicts you already recorded survive it.</p>

    <div style="display:flex;gap:8px;margin:16px 0 6px">
      <button class="wide" data-msg='{"type":"reinfer"}'>Re-infer ${
        plural(d.needs_inference.length, 'table')}</button>
      <button class="wide" data-msg='{"type":"close"}'
              style="background:var(--vscode-button-secondaryBackground,#313131);
                     color:var(--vscode-button-secondaryForeground,#cccccc)">Not now</button>
    </div>
  </div>`, { wide: true });
}

// ---------------------------------------------------------------------------
// the sidebar
// ---------------------------------------------------------------------------

export type ClientState = 'absent' | 'present' | 'configured';

/** What the no-engine panel offers, which depends on what the machine has. */
export interface EngineOffer {
  kind: 'install';
  label: string;
  command: string;
  note: string;
  /** Other ways to get there, for anyone whose org blocks piping curl to sh. */
  alternatives: { label: string; command: string; note: string }[];
}

export interface PanelState {
  cli: string | null;
  /**
   * Whether the installed engine has `semlayer demo`.
   *
   * Detected, not assumed. The command landed after 0.7.0b2, so a user on the
   * published version does not have it -- and a button offering a sample that
   * does not exist is exactly the dead end this replaced.
   */
  canDemo?: boolean;
  offer?: EngineOffer;
  /** Running through uvx, which fetches on first use and is worth announcing. */
  viaUvx?: boolean;
  layer: { name: string; tables: number | null } | undefined;
  others: number;
  clients: { label: string; state: ClientState }[];
  drift: string | null;
}

export function renderPanel(s: PanelState): string {
  return shell(!s.cli ? noCli(s) : s.layer ? resting(s) : walkthrough(s));
}

function noCli(s: PanelState): string {
  const o = s.offer;
  // Nothing usable. The instruction must not assume Python: a VS Code user may
  // have none, and `uv` is a single binary that brings its own.
  return `<div class="pad">
    <p>semlayer needs its engine, which is a one-time install.</p>
    <p class="dim">The extension runs the same CLI you would run in a terminal;
    it carries no engine of its own.</p>
    ${o ? `<pre>${esc(o.command)}</pre>
      <p class="dim">${esc(o.note)}</p>
      <button data-cmd="semlayer.install">Run this in a terminal</button>
      <p class="dim">It opens a terminal so you can see exactly what runs.</p>
      ${o.alternatives.length ? `<details><summary class="dim">Other ways</summary>
        ${o.alternatives.map((a) => `<p><b>${esc(a.label)}</b><br>
          <code>${esc(a.command)}</code><br>
          <span class="dim">${esc(a.note)}</span></p>`).join('')}
      </details>` : ''}` : ''}
    <button class="outline" data-cmd="semlayer.recheck">Check again</button>
    <p class="dim">Press this after an install finishes. We look on your PATH and
    in the places these installers use, so nothing needs restarting.</p>
    <details><summary class="dim">If you already installed semlayer on this
      machine, set the path to it</summary>
      <p class="dim">We looked on your PATH and in the usual install locations
      and did not find it. Set <code>semlayer.cliPath</code> to where yours is:</p>
      <p class="dim"><code>/usr/local/bin/semlayer</code><br>
      <span style="opacity:.8">a path to the executable</span></p>
      <p class="dim"><code>uvx --python 3.13 --from semlayer[warehouses] semlayer</code><br>
      <span style="opacity:.8">or a whole command, if that is how you run it</span></p>
      <button class="outline" data-cmd="semlayer.openSetting">Set the path</button>
      <button class="outline" data-cmd="semlayer.showOutput">Show what we tried</button>
    </details>
  </div>`;
}

function walkthrough(s: PanelState): string {
  const step = (cmd: string, title: string, sub: string) => `
    <div class="row act" data-cmd="${cmd}"><span class="mark">&#9675;</span>
      <span class="t">${title}<br><span class="dim">${sub}</span></span></div>`;
  return `<div class="pad">
    <p>semlayer reads a warehouse it can already reach and writes one YAML file
    your agent loads over MCP.</p>
    ${s.viaUvx ? `<p class="dim">Running through <code>uvx</code>. The first
      command downloads the engine and, if this machine has no Python, a Python
      to run it on &mdash; a minute or two, once. After that it is cached and
      calls take about a quarter of a second.</p>` : ''}
  </div>
  <h3>Get started</h3>
  ${step('semlayer.createLayer', 'Create a semantic layer',
         'point it at a warehouse &mdash; the cost is shown before anything runs')}
  ${step('semlayer.configureClient', 'Query it',
         'serve the layer to an agent over MCP')}
  <div class="pad">
    <button data-cmd="semlayer.createLayer">Create a semantic layer</button>
    ${s.canDemo
      ? `<button class="outline" data-cmd="semlayer.trySample">Try it on a sample warehouse</button>
         <p class="dim">36 tables with cryptic names, no declared keys and rules
         nobody wrote down. No credentials, no API key.</p>` : ''}
    <button class="outline" data-cmd="semlayer.loadLayer">Open an existing layer file</button>
  </div>`;
}

function resting(s: PanelState): string {
  const l = s.layer!;
  // `present` means the client has a config file here but no semlayer entry:
  // those are the ones worth offering. `absent` clients have never run on this
  // machine, so naming them would be noise.
  const configured = s.clients.filter((c) => c.state === 'configured').map((c) => c.label);
  const missing = s.clients.filter((c) => c.state === 'present').map((c) => c.label);
  const sub = [
    l.tables === null ? '' : plural(l.tables, 'table'),
    s.others ? `${plural(s.others, 'other layer')} here` : '',
  ].filter(Boolean).join(' · ');

  return `<div class="row act" data-cmd="semlayer.selectLayer" title="Choose a different layer">
    <span class="mark ok">&#10003;</span>
    <span class="t"><b>${esc(l.name)}</b><br><span class="dim">${esc(sub)}</span></span>
  </div>
  <h3>MCP clients</h3>
  <div class="pad" style="padding-top:0">
    ${configured.map((c) => `<div class="row"><span class="mark ok">&#10003;</span>
       <span class="t">${esc(c)}</span></div>`).join('')}
    ${missing.map((c) => `<div class="row"><span class="mark dim">&#9675;</span>
       <span class="t dim">${esc(c)}</span></div>`).join('')}
    ${!configured.length && !missing.length
      ? '<p class="dim">No MCP client found on this machine.</p>' : ''}
    <button data-cmd="semlayer.configureClient">${
      missing.length ? `Connect ${esc(missing[0])}` : 'Connect an MCP client'}</button>
  </div>
  <h3>Findings</h3>
  <div class="pad" style="padding-top:0">
    <button data-cmd="semlayer.review">Review findings</button>
    <p class="dim" style="margin-top:4px">Optional. The layer works with every question open.</p>
  </div>
  <h3>Maintenance</h3>
  <div class="pad" style="padding-top:0">
    ${s.drift
      ? `<div class="row"><span class="mark warn">&#9679;</span>
           <span class="t">${esc(s.drift)}<br>
           <span class="dim">the warehouse moved since this was built</span></span></div>`
      : '<p class="dim">No drift detected.</p>'}
    <button class="${s.drift ? '' : 'outline'}" data-cmd="semlayer.drift">${
      s.drift ? 'See what changed' : 'Check for drift'}</button>
    <button class="outline" data-cmd="semlayer.settings">Rebuild with settings</button>
    ${s.others
      ? `<button class="outline" data-cmd="semlayer.stitch">Stitch ${
           plural(s.others + 1, 'layer')} into a hub</button>
         <p class="dim" style="margin-top:4px">Infers the joins between layers that were
         built separately.</p>`
      : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

export interface ReviewObject { where: string; table: string; column: string | null; evidence: string }

export interface Question {
  n: number;
  key: string;
  kind: string;
  claim: string;
  engine_saw: string;
  confidence: number | null;
  count: number;
  objects: ReviewObject[];
  on_accept: string;
  on_reject: string;
  set_accepts: string | null;
}

export interface Queue {
  document: string;
  undecided_items: number;
  questions: Question[];
  not_asked?: unknown[];
}

/**
 * Which kinds can change the answer to a question, and which are bookkeeping.
 *
 * This ordering is the screen's whole argument. Sorted by object count the top
 * of the queue is a twenty-object naming question, and the rule that decides
 * whether revenue includes cancelled orders sits below the fold.
 */
export const CONSEQUENTIAL = new Set([
  'discovered_filter',
  'aggregate_mapping',
  'fk_candidate',
  'metric_plausibility',
]);

const KIND_LABEL: Record<string, string> = {
  low_confidence: 'not sure',
  discovered_filter: 'rule found',
  aggregate_mapping: 'rollup matched',
  fk_candidate: 'key candidate',
  metric_plausibility: 'metric',
};

/** Consequential first; within each group the engine's own order is kept. */
export function sortQuestions(qs: Question[]): Question[] {
  return [...qs].sort((a, b) =>
    Number(CONSEQUENTIAL.has(b.kind)) - Number(CONSEQUENTIAL.has(a.kind)));
}

export function renderReview(q: Queue | null, selected: number, busy: boolean): string {
  if (!q) {
    return shell(`<div class="pad"><h2>Nothing to review</h2>
      <p>The queue could not be read. <b>semlayer: Show output</b> says why.</p></div>`,
      { wide: true });
  }
  const qs = q.questions;
  if (!qs.length) {
    return shell(`<div class="pad"><h2>Every question is answered</h2>
      <p>${plural(q.undecided_items, 'item')} were undecided and none are still open.</p>
      </div>`, { wide: true });
  }

  const consequential = qs.filter((x) => CONSEQUENTIAL.has(x.kind));
  const routine = qs.filter((x) => !CONSEQUENTIAL.has(x.kind));
  const cur = qs[Math.min(Math.max(selected, 0), qs.length - 1)];

  const row = (x: Question, i: number) => `
    <div class="q ${i === selected ? 'sel' : ''}" data-msg='{"type":"select","index":${i}}'>
      <div class="qmeta">
        <span class="kind">${esc(KIND_LABEL[x.kind] ?? x.kind)}</span>
        ${x.confidence !== null
          ? `<span class="conf ${x.confidence >= 0.6 ? 'warn' : 'bad'}">${x.confidence.toFixed(2)}</span>`
          : ''}
        <span class="dim">${plural(x.count, 'object')}</span>
      </div>
      <div class="claim">${esc(x.claim)}</div>
    </div>`;

  return shell(`
  <header>
    <div><b>${consequential.length} change an answer</b>${routine.length
      ? `<span class="dim"> &middot; ${routine.length} other${routine.length === 1 ? '' : 's'}
         are naming and typing</span>` : ''}</div>
    ${routine.length
      ? `<button class="wide" data-msg='{"type":"bulk","keys":${
          JSON.stringify(routine.map((x) => x.key))}}' ${busy ? 'disabled' : ''}
         >Accept all ${routine.length}</button>` : ''}
  </header>

  <div class="split">
    <div class="list">${qs.map(row).join('')}</div>
    <div class="detail">
      <div class="dim mono" style="text-transform:uppercase;letter-spacing:.05em;font-size:10px"
        >${esc(KIND_LABEL[cur.kind] ?? cur.kind)} &middot; ${esc(cur.key)}</div>
      <h2>${esc(cur.claim)}</h2>
      <p>What it saw: ${esc(cur.engine_saw)}</p>

      <div class="cons">
        <div class="a"><b>If you accept</b>${esc(cur.on_accept)}</div>
        <div class="r"><b>If you reject</b>${esc(cur.on_reject)}</div>
      </div>

      <table>
        <thead><tr><th>Object</th><th>Evidence</th></tr></thead>
        <tbody>${cur.objects.slice(0, 12).map((o) => `
          <tr><td class="mono">${esc(o.where)}</td>
              <td class="dim">${esc(o.evidence)}</td></tr>`).join('')}
        </tbody>
      </table>
      ${cur.objects.length > 12
        ? `<p class="dim">Showing 12 of ${cur.objects.length}.</p>` : ''}

      <div class="acts">
        <button class="wide" data-msg='{"type":"skip"}' ${busy ? 'disabled' : ''}
          style="background:var(--vscode-button-secondaryBackground,#313131);
                 color:var(--vscode-button-secondaryForeground,#cccccc)">Skip</button>
        <span style="flex:1"></span>
        <button class="wide" data-msg='{"type":"answer","key":"${esc(cur.key)}","verdict":"reject"}'
          ${busy ? 'disabled' : ''}
          style="background:var(--vscode-button-secondaryBackground,#313131);
                 color:var(--vscode-button-secondaryForeground,#cccccc)">Reject</button>
        <button class="wide" data-msg='{"type":"answer","key":"${esc(cur.key)}","verdict":"accept"}'
          ${busy ? 'disabled' : ''}>Accept${cur.count === 1 ? '' : ` ${cur.count}`}</button>
      </div>
      <p class="dim">Every verdict records who decided it and when, so the next
      re-inference keeps it instead of asking again.</p>
    </div>
  </div>
  <style>
    header{display:flex;align-items:center;gap:12px;padding:10px 20px;
           border-bottom:1px solid var(--vscode-panel-border, #2b2b2b)}
    header button{margin-left:auto}
    .split{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);
           height:calc(100vh - 42px)}
    .list{overflow-y:auto;border-right:1px solid var(--vscode-panel-border, #2b2b2b)}
    .q{padding:9px 14px;cursor:pointer;
       border-bottom:1px solid var(--vscode-panel-border, #2b2b2b)}
    .q:hover{background:var(--vscode-list-hoverBackground, #2a2d2e)}
    .q.sel{background:var(--vscode-list-activeSelectionBackground, #04395e)}
    .qmeta{display:flex;gap:7px;align-items:center;margin-bottom:3px;font-size:10px}
    .kind{font-family:var(--vscode-editor-font-family);text-transform:uppercase;
          letter-spacing:.05em;color:var(--vscode-textLink-foreground, #4daafc)}
    .conf{font-family:var(--vscode-editor-font-family);padding:1px 5px;border-radius:8px;
          border:1px solid var(--vscode-panel-border, #2b2b2b)}
    .claim{font-size:12.5px;line-height:1.4}
    .detail{overflow-y:auto;padding:16px 22px}
    .cons{display:flex;gap:10px;margin:16px 0;flex-wrap:wrap}
    .cons>div{flex:1;min-width:220px;border:1px solid var(--vscode-panel-border, #2b2b2b);
              border-radius:3px;padding:9px 12px;font-size:12.5px}
    .cons b{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;
            margin-bottom:3px}
    .cons .a b{color:var(--vscode-charts-green, #89d185)}
    .cons .r b{color:var(--vscode-editorError-foreground, #f14c4c)}
    .acts{display:flex;gap:8px;align-items:center;margin:18px 0 4px}
  </style>`, { wide: true });
}

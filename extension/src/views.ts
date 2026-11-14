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
  /* The list, which is what VS Code uses wherever a user picks one of several
     things. Rows are 22px and full-bleed, the icon slot is fixed so labels
     align down the column, and the trailing meta ellipsises rather than
     wrapping -- a wrapping row breaks the 22px rhythm the pattern rests on. */
  .sect{display:flex;align-items:center;gap:4px;height:22px;padding:0 12px;
        font-size:11px;text-transform:uppercase;letter-spacing:.04em;
        font-weight:600;opacity:.8;margin-top:10px}
  .lrow{display:flex;align-items:center;gap:6px;height:22px;
        padding:0 12px 0 24px;cursor:pointer;user-select:none}
  .lrow:hover{background:var(--vscode-list-hoverBackground, #2a2d2e)}
  .lrow[aria-selected=true]{
        background:var(--vscode-list-activeSelectionBackground, #04395e)}
  .lrow .i{width:16px;flex:none;text-align:center;opacity:.9}
  .lrow .l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lrow .m{flex:1;min-width:0;font-size:12px;white-space:nowrap;
           overflow:hidden;text-overflow:ellipsis;
           color:var(--vscode-descriptionForeground)}
  /* A row we found but cannot open. Still listed, because knowing it was seen
     and why it is unusable is the answer; it just cannot be chosen. */
  .lrow.off{cursor:default}
  .lrow.off:hover{background:transparent}
  .lrow.off .l{color:var(--vscode-disabledForeground, #6e6e6e)}
  .i.link{color:var(--vscode-textLink-foreground, #4daafc)}
  .i.accent{color:var(--vscode-charts-purple, #b180d7)}
  .i.warn{color:var(--vscode-editorWarning-foreground, #cca700)}
  .i.dim{color:var(--vscode-descriptionForeground)}
  /* Captions align under the icon, not the label: the mock's indent. */
  .cap{padding:2px 12px 8px 24px;font-size:12px;
       color:var(--vscode-descriptionForeground)}
  /* The three steps. A checklist that ticks, not a wizard rail. */
  .steps{padding:6px 0 8px;
         border-bottom:1px solid var(--vscode-panel-border, #2b2b2b)}
  .step{display:flex;align-items:baseline;gap:6px;padding:3px 12px}
  .step.act{cursor:pointer}
  .step.act:hover{background:var(--vscode-list-hoverBackground, #2a2d2e)}
  .step .t{flex:1}
  .step .meta{font-size:12px;white-space:nowrap;
              color:var(--vscode-disabledForeground, #6e6e6e)}
  /* A finished step is a way BACK, so it is coloured and underlined like the
     link it is. Without that nobody could tell the rows were clickable: they
     were styled as a static checklist and read as one. */
  .step.done .t{color:var(--vscode-textLink-foreground, #4daafc)}
  .step.act:hover .t{text-decoration:underline}
  .step.now .t{font-weight:600}
  .step.todo .t{color:var(--vscode-disabledForeground, #6e6e6e)}
  .step.done .mark{color:var(--vscode-charts-green, #89d185)}
  .step.now .mark{color:var(--vscode-foreground)}
  .step.todo .mark{color:var(--vscode-disabledForeground, #6e6e6e)}
  /* Day 2: a destination, not a step, so it sits below a rule. */
  .rule{border-top:1px solid var(--vscode-panel-border, #2b2b2b);margin:5px 12px}
  .step.home .t{color:var(--vscode-textLink-foreground, #4daafc)}
  .step.home .mark{color:var(--vscode-charts-purple, #b180d7)}
  .step.home.now .t{color:var(--vscode-foreground)}
  /* The indeterminate bar VS Code puts under a view title. */
  .bar{height:2px;margin-top:16px;overflow:hidden;
       background:var(--vscode-panel-border, #2b2b2b)}
  .bar>div{height:2px;width:34%;
           background:var(--vscode-progressBar-background, #0078d4);
           animation:slide 1.6s ease-in-out infinite}
  @keyframes slide{0%{margin-left:-34%}100%{margin-left:100%}}
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
  /**
   * Model id, empty for the engine's default (the cheap tier).
   *
   * Free text rather than a dropdown of ids: a hard-coded list goes stale
   * with every model release, and which models an account can reach is not
   * something this extension knows. The engine's own error names the problem
   * if the id is wrong or unavailable.
   */
  model: string;
  noSampleEgress: boolean;
  noLlmCache: boolean;
  noDeclaredConstraints: boolean;
  llmWorkers: number;
  queryWorkers: number | null;
  schema: string;
  name: string;
  /** Output path, empty for the engine's default of `<document name>.yaml`. */
  out: string;
  manifest: string;
  context: string[];
  // No `openPr`. There was a checkbox for it, wired to nothing: no flag, no
  // command, and no PR-opening verb in the engine. What actually opens a pull
  // request is `examples/maintain/semlayer-maintain.yml`, a workflow that runs
  // in the repo holding the layer. Offering that from here is its own piece of
  // work; a control that silently does nothing is not a down payment on it.
}

/** The default model, for the placeholder. Must match the engine's CHEAP_MODEL. */
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export const DEFAULT_SETTINGS: Settings = {
  noLlm: false, model: '', noSampleEgress: false, noLlmCache: false,
  noDeclaredConstraints: false,
  llmWorkers: 4, queryWorkers: null, schema: '', name: '', out: '', manifest: '',
  context: [],
};

/**
 * Settings -> argv. The single place that knows the flag spellings.
 *
 * `withOut: false` for the one caller that cannot take `-o`: targeted
 * re-inference passes `--into`, which merges into a layer that already exists,
 * and an output path alongside it would be two answers to where the result
 * goes.
 */
export function settingsToArgs(s: Settings, opts: { withOut?: boolean } = {}): string[] {
  const a: string[] = [];
  if (s.noLlm) { a.push('--no-llm'); }
  if (!s.noLlm && s.model.trim()) { a.push('--model', s.model.trim()); }
  if (s.noSampleEgress) { a.push('--no-sample-egress'); }
  if (s.noLlmCache) { a.push('--no-llm-cache'); }
  if (s.noDeclaredConstraints) { a.push('--no-declared-constraints'); }
  if (s.llmWorkers !== 4) { a.push('--llm-workers', String(s.llmWorkers)); }
  if (s.queryWorkers !== null) { a.push('--query-workers', String(s.queryWorkers)); }
  if (s.schema.trim()) { a.push('--schema', s.schema.trim()); }
  if (s.name.trim()) { a.push('--name', s.name.trim()); }
  if (opts.withOut !== false && s.out.trim()) { a.push('-o', s.out.trim()); }
  if (s.manifest.trim()) { a.push('--manifest', s.manifest.trim()); }
  for (const c of s.context) { if (c.trim()) { a.push('--context', c.trim()); } }
  return a;
}

const check = (id: keyof Settings, on: boolean, title: string, why: string) => `
  <label><input type="checkbox" data-set="${id}" ${on ? 'checked' : ''}>
    <span><b>${esc(title)}</b><br><span class="dim">${why}</span></span></label>`;

/**
 * The inference flags, as a form.
 *
 * Extracted so Create and Day 2 render the SAME component rather than two
 * shapes of the same settings -- which is what the mock asks for, on the
 * grounds that the settings a user chose at Create are the ones they come back
 * to adjust, and showing them differently in each place makes them look like
 * different settings.
 */
function settingsFields(s: Settings): string {
  return `<fieldset><legend>Cost</legend>
      ${check('noLlm', s.noLlm, 'Deterministic only, no model',
        'Free and fast. Keys, types, relationships and metrics still come out; descriptions do not.')}
      <label style="display:block"><span class="dim">Model</span>
        <input type="text" data-set="model" value="${esc(s.model)}"
               placeholder="${DEFAULT_MODEL}">
        <span class="dim">The cheap tier by default, which is what the estimate above and
        our published $0.70/100 tables are measured on. A larger model writes better
        descriptions and costs more. Whatever runs is recorded in the document.</span></label>
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
      <label style="display:block"><span class="dim">Write to</span>
        <input type="text" data-set="out" value="${esc(s.out)}"
               placeholder="${esc(s.name.trim() || s.schema.trim() || '<name>')}.yaml">
        <span class="dim">Relative to the folder you opened. Default: the document name
        with <span class="mono">.yaml</span>, which is the schema or the warehouse
        unless you set a name above.</span></label>
    </fieldset>`;
}

/** The form's behaviour: keep the state, and show the command it builds. */
function settingsScript(s: Settings, source: string): string {
  return `
    const state = ${JSON.stringify(s)};
    const cmd = () => {
      const a = [];
      if (state.noLlm) a.push('--no-llm');
      if (!state.noLlm && state.model.trim()) a.push('--model', state.model.trim());
      if (state.noSampleEgress) a.push('--no-sample-egress');
      if (state.noLlmCache) a.push('--no-llm-cache');
      if (state.noDeclaredConstraints) a.push('--no-declared-constraints');
      if (+state.llmWorkers !== 4) a.push('--llm-workers', state.llmWorkers);
      if (state.schema) a.push('--schema', state.schema);
      if (state.name) a.push('--name', state.name);
      if (state.out.trim()) a.push('-o', state.out.trim());
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
  `;
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

export interface ScopeState {
  probe: Probe;
  source: string;
  settings: Settings;
  steps: Steps;
  /**
   * The run is going.
   *
   * The screen STAYS during it. Leaving on click sent the sidebar back to
   * step one -- so pressing Create appeared to undo itself, and the run the
   * user had just authorised happened somewhere they could not see.
   */
  running?: boolean;
  /** Whether there is a built layer to go back to. */
  hasLayer?: boolean;
  /**
   * Open the settings section on arrival.
   *
   * Set when the user asked for the settings by name -- "Rebuild with
   * settings" is step two, and landing on step two with the settings still
   * folded away answers a different request than the one they made.
   */
  expanded?: boolean;
}

/**
 * Step two, in the sidebar.
 *
 * It opened as an editor tab until a walkthrough caught what that costs: step
 * one is in the sidebar, so choosing a warehouse threw the user into the
 * centre pane, with a tab titled with the warehouse's absolute path. The flow
 * left the surface it started on halfway through, which is what made it read
 * as two products rather than three steps.
 *
 * The settings live here, collapsed, rather than behind a button to a third
 * screen -- same component as Day 2's, so a user adjusting what they chose at
 * Create meets the form they chose it in.
 */
export function renderScope(s: ScopeState): string {
  const { probe: p, source, settings } = s;
  const e = estimate(p.tables, settings.noLlm);
  const g = GRADE[p.grade] ?? GRADE.fair;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return shell(`${checklist(s.steps)}
  <div class="pad">
    <h2>${plural(p.tables, 'table')} found</h2>
    <p><span class="mono">${esc(source)}</span></p>

    <div class="big" style="margin:14px 0 2px">${e.wall} &middot; ${e.spend}
      <span class="dim" style="font-size:12px;font-weight:400">estimated</span></div>
    <p class="dim" style="margin-top:0">${s.running
      ? 'This is the estimate it started from.'
      : 'Nothing has been read or spent yet.'}</p>

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

    ${settings.noLlm ? '<div class="note">Deterministic mode: free, and no descriptions are written. Keys, types, relationships and metrics still come out.</div>' : ''}

    ${!settings.noLlm && settings.model.trim() ? `<div class="note">Running
      <span class="mono">${esc(settings.model.trim())}</span>, not the default model.
      The estimate above is priced on the default, so treat it as a floor.</div>` : ''}

    ${settings.out.trim() ? `<p class="dim">Writes
      <span class="mono">${esc(settings.out.trim())}</span>.</p>` : ''}

    ${s.running ? `<div class="bar"><div></div></div>
      <p style="margin-top:10px">Reading ${esc(source)}&hellip;</p>
      <p class="dim">Safe to close the editor. The run resumes from cache, so
      an interrupted one does not start over or pay twice.</p>`
    : `<button data-msg='{"type":"create"}'>Create semantic layer</button>
    <button class="outline" data-msg='{"type":"back"}'>Pick a different warehouse</button>

    <details style="margin-top:14px"${s.expanded ? ' open' : ''}>
      <summary class="dim" style="cursor:pointer">Advanced &middot; settings</summary>
      ${settingsFields(settings)}
      <pre id="cmd">semlayer infer ${esc(source)}</pre>
    </details>`}
  </div>`, { script: s.running ? '' : settingsScript(settings, source) });
}

// ---------------------------------------------------------------------------
// connect: which warehouse, out of the ones this machine can already see
// ---------------------------------------------------------------------------

/** One row of `semlayer discover --json`. */
export interface Connection {
  uri: string;
  kind: string;
  source: string;
  supported: boolean;
  note: string | null;
}

/** A layer already sitting in the workspace. The mock's top row. */
export interface WorkspaceLayer {
  /** Workspace-relative path, which is how the mock names it. */
  file: string;
  /** Absolute path, which is what loading it actually needs. */
  path: string;
  /** The dim trailing line: tables and age. */
  meta: string;
}

export interface ConnectState {
  conns: Connection[];
  layers: WorkspaceLayer[];
  canDemo: boolean;
  /**
   * `semlayer init <family>` output per family, fetched before the screen
   * opens.
   *
   * Prefetched rather than loaded on demand because the grants shown are the
   * ones for the SELECTED row: fetching on expand would mean a round trip and
   * a re-render, and a re-render loses the selection that decides which block
   * to show.
   */
  grants: Record<string, string>;
  /** Whether there is anything to go back to. False on a first run. */
  canCancel?: boolean;
  /** The checklist above it. Supplied by the panel, which knows the progress. */
  steps: Steps;
  /**
   * Running through uvx, whose first call fetches.
   *
   * It is announced HERE because this is now the first screen anyone with a
   * working engine sees. It used to live on the "Get started" panel, which no
   * longer exists -- and deleting that panel silently took the warning with
   * it, leaving the one user who most needs it (no Python, cold cache) to
   * meet a two-minute download with no explanation.
   */
  viaUvx?: boolean;
}

/** How each family introduces its own script. The mock's wording. */
const GRANT_INTRO: Record<string, string> = {
  snowflake: 'Snowflake. Run as ACCOUNTADMIN:',
  bigquery: 'BigQuery. Not SQL: these are IAM bindings.',
  postgres: 'PostgreSQL:',
};

/** Which family's grants a URI needs. Mirrors `flows.familyOf`. */
function familyOfUri(uri: string): string {
  return uri.startsWith('duckdb') ? 'duckdb'
    : uri.startsWith('bigquery') ? 'bigquery'
    : uri.startsWith('snowflake') ? 'snowflake'
    : 'postgres';
}

/**
 * The three steps, the way VS Code onboards: a checklist that ticks.
 *
 * It stays visible after all three are done, and every row is clickable, which
 * is a deliberate departure from the mock. The mock collapses it on day 2 on
 * the grounds that a persistent "step 1 of 3" implies an obligation. True --
 * but it is also the only way back: someone who tried the sample and now wants
 * their own warehouse has to reach step one again, and with the checklist gone
 * there was nothing to click. Ticked rows read as a record, not a demand.
 *
 * `step` is the one in progress; pass 4 when all three are done.
 */
export function checklist(s: Steps): string {
  const labels = ['Connect to a warehouse', 'Create the semantic layer',
                  'Query your warehouse'];
  const row = (label: string, state: string, mark: string, cmd: string,
               detail: string) => `<div class="step act ${state}"
    data-cmd="${esc(cmd)}" title="${esc(label)}"><span class="mark">${mark}</span><span
    class="t">${esc(label)}</span><span class="meta">${esc(detail)}</span></div>`;

  const steps = labels.map((label, i) => {
    const state = i + 1 < s.step ? 'done' : i + 1 === s.step ? 'now' : 'todo';
    return row(label, state, state === 'done' ? '&#10003;'
      : state === 'now' ? '&#9679;' : '&#9675;', s.cmds[i], s.detail[i]);
  }).join('');

  // The fourth row sits below a rule because it is NOT a step: the three
  // happen once, this is where you live afterwards. It appears only once a
  // layer exists, so a first run shows exactly the three the mock specifies
  // -- there is nothing to maintain before there is something to maintain.
  const m = s.maintain;
  return `<div class="steps">${steps}${m
    ? `<div class="rule"></div>${row(m.label, m.current ? 'home now' : 'home',
        '&#9673;', m.cmd, m.detail)}`
    : ''}</div>`;
}

/** The sidebar's four destinations. */
export type Screen = 'connect' | 'scope' | 'serve' | 'home';

/**
 * Which screen the sidebar shows.
 *
 * Pure, exported and tested, because getting it wrong is this extension's
 * most repeated bug and none of the render tests could see it. It was three
 * independent booleans -- `forceConnect`, a scope object, a `serving` flag --
 * read in a fixed priority order, so a navigation that set one without
 * clearing the others silently did nothing: clicking "Connect to a warehouse"
 * from the Create screen set `forceConnect`, but `scope` was still set and
 * still won.
 *
 * One value, so the states cannot overlap. `requested` is where the user
 * asked to be; the rest is what is actually possible.
 */
export function screenFor(requested: Screen | undefined,
                          opts: { hasLayer: boolean; hasScope: boolean }): Screen {
  // Scope needs a probed warehouse, serve needs a built layer. Asking for one
  // without it falls through rather than rendering an empty screen.
  if (requested === 'scope' && opts.hasScope) { return 'scope'; }
  if (requested === 'serve' && opts.hasLayer) { return 'serve'; }
  if (requested === 'connect') { return 'connect'; }
  if (requested === 'home' && opts.hasLayer) { return 'home'; }
  // Nowhere in particular: the layer if there is one, step one if not.
  return opts.hasLayer ? 'home' : 'connect';
}

/**
 * The badge on the activity-bar icon: open questions, or nothing.
 *
 * Three states and only one of them is a badge. A count shows it; zero does
 * not, because a badge is an interruption and "you are done" does not need
 * one (the panel says so in words); null does not either, since an unknown
 * count must never be drawn as a number.
 *
 * Pure and here rather than in the panel so it can be asserted without an
 * extension host.
 */
export function badgeFor(open: number | null | undefined):
    { value: number; tooltip: string } | undefined {
  if (typeof open !== 'number' || open <= 0) { return undefined; }
  return { value: open, tooltip: `${plural(open, 'finding')} to review` };
}

/** What the sidebar needs in order to draw the checklist. */
export interface Steps {
  /** The step in progress; 4 means all three are done. */
  step: 1 | 2 | 3 | 4;
  detail: [string, string, string];
  cmds: [string, string, string];
  /** Day 2. Present only once there is a layer to maintain. */
  maintain?: { label: string; detail: string; cmd: string; current: boolean };
}

/**
 * Step one, and the one screen the mock specified that was never built.
 *
 * `test/features.mjs` carried it as `connect.discovery`, `kind: 'gap'`, with
 * the reason "No CLI verb does this" -- true until `semlayer discover` landed.
 * What shipped in its place was `showInputBox` with the URI syntax in its
 * placeholder, which asks the user to already know the answer.
 *
 * The FORM is the point, and it is a list, not a stack of buttons. Every
 * option -- an existing layer, the sample, each discovered connection, and
 * "Connect something else" -- is the same 22px row, and you SELECT one; a
 * single primary button then names what will happen to the thing you chose.
 * A pile of buttons was the first attempt and it is the pattern
 * `beta/ux/design-prompt.md` explicitly rules out: "Radio buttons in cards ->
 * a list: full-bleed rows, 22px tall, codicon on the left".
 *
 * The grants follow the selection rather than sitting in a list of their own,
 * because a DuckDB file has no grants at all and three families offered at
 * once makes the user answer a question they already answered by picking.
 */
export function renderConnect(s: ConnectState): string {
  /** What the webview needs to know about a row. Kept to the minimum. */
  type Choice = { id: string; kind: string; family: string; source: string;
                  button: string; usable: boolean };

  const rows: string[] = [];
  const choices: Choice[] = [];

  const row = (c: Omit<Choice, 'usable'>, o: { icon: string; tone: string;
                 label: string; meta: string; usable?: boolean }) => {
    const full = { ...c, usable: o.usable !== false };
    choices.push(full);
    rows.push(`<div class="lrow${full.usable ? '' : ' off'}"
      data-choice='${esc(JSON.stringify(full))}' aria-selected="false">
      <span class="i ${o.tone}">${o.icon}</span>
      <span class="l">${esc(o.label)}</span>
      <span class="m">${esc(o.meta)}</span></div>`);
  };
  const caption = (text: string) => rows.push(`<div class="cap">${text}</div>`);
  const section = (label: string) => rows.push(`<div class="sect">${label}</div>`);

  if (s.layers.length) {
    section('Layer in this workspace');
    // Family 'layer', which shows no grants at all: loading a document someone
    // already built reads no warehouse, so access to one is not the question.
    s.layers.forEach((l, i) => row(
      { id: `l${i}`, kind: 'layer', family: 'layer', source: l.path,
        button: `Load ${l.file}` },
      { icon: '&#9670;', tone: 'link', label: l.file, meta: l.meta }));
    caption('Loading it skips Create. Nothing is inferred and nothing is spent.');
  }

  section(s.layers.length ? 'Or start from a warehouse' : 'Start from a warehouse');

  if (s.canDemo) {
    // Family 'none', not 'duckdb', although the sample IS a DuckDB file. The
    // family decides which grants to show, and the sample is not a warehouse
    // anyone has to be granted access to -- so it must not suppress the
    // grants the way a real DuckDB connection does. Suppressing them here
    // hid them on precisely the machine where nothing is configured yet.
    row({ id: 'sample', kind: 'sample', family: 'none', source: '',
          button: 'Use the sample warehouse' },
        { icon: '&#9671;', tone: 'accent', label: 'Sample warehouse',
          meta: '36 tables, no credentials, no API key' });
    caption('~2s to generate it, 3.5s to infer over it: 36 tables, 37 discovered '
          + 'relationships and 19 metrics, with no model called. 0 of 36 tables '
          + 'get a description &mdash; an API key is what buys prose.');
  }

  s.conns.forEach((c, i) => {
    row({ id: `c${i}`, kind: 'conn', family: familyOfUri(c.uri), source: c.uri,
          button: 'Connect' },
        { icon: c.supported ? '&#9679;' : '&#9888;',
          tone: c.supported ? 'link' : 'warn',
          label: c.uri, usable: c.supported, meta: c.source });
    // The note goes UNDER the row, not in its trailing slot. A row ellipsises
    // to keep the 22px rhythm, and what it was clipping here is the one thing
    // that makes an unusable connection actionable: which variable is missing.
    if (c.note) { caption(esc(c.note)); }
  });

  row({ id: 'other', kind: 'other', family: '', source: '', button: 'Connect' },
      { icon: '+', tone: 'dim', label: 'Connect something else…', meta: '' });

  // Discovery only looks in this workspace, so a layer living anywhere else
  // had no route in once the browse button became a row. Kept as a row rather
  // than restored as a button: the list is the whole form of this screen.
  row({ id: 'browse', kind: 'browse', family: 'layer', source: '',
        button: 'Open a layer file' },
      { icon: '&#9670;', tone: 'dim', label: 'Open an existing layer file…',
        meta: '' });

  // The DSN field belongs here, under the row that asks for it. Closing the
  // screen to throw a modal input box at the user was the previous shape, and
  // it loses the list you were choosing from.
  rows.push(`<div id="dsnwrap" style="display:none;padding:6px 12px 0 24px">
    <input type="text" id="dsn" spellcheck="false"
           placeholder="snowflake://user@account/db?warehouse=&hellip;">
    <div class="cap" style="padding:4px 0 0">A connection string or DSN &mdash;
      Snowflake, BigQuery, Postgres, Databricks, or a path to a DuckDB file.</div>
  </div>`);

  const families = Object.keys(s.grants);

  // Which row starts selected, and therefore which grants start visible. Done
  // here rather than in the script so the HTML itself says what state it opens
  // in -- a `display` decided only at runtime cannot be asserted or shot.
  const first = choices.find((c) => c.kind === 'layer')
    ?? choices.find((c) => c.kind === 'conn' && c.usable)
    ?? choices.find((c) => c.kind === 'sample')
    ?? choices[choices.length - 1];
  const advOpen = first.family !== 'duckdb' && first.family !== 'layer';

  return shell(`${checklist(s.steps)}
  <div class="pad" style="padding-bottom:0"><p>semlayer reads a warehouse it can
    already reach and writes one YAML file your agent loads over MCP.</p>
    ${s.viaUvx ? `<p class="dim">Running through <code>uvx</code>. The first
      command downloads the engine and, if this machine has no Python, a Python
      to run it on &mdash; a minute or two, once. After that it is cached and
      calls take about a quarter of a second.</p>` : ''}</div>

  ${rows.join('')}

  ${!s.conns.length ? `<div class="pad"><div class="note"
    >No warehouse connections found on this machine.<br>We looked at your
    environment, dbt profiles, a Snowflake
    <span class="mono">connections.toml</span> and DuckDB files in this
    folder.</div></div>` : ''}

  <div class="pad" style="padding-top:12px">
    <button id="go" style="margin-top:0">Connect</button>
    <div class="cap" style="padding:6px 0 0">Read-only. semlayer runs SELECT and
      catalogue queries, nothing else.</div>
  </div>

  <div class="pad" id="adv" style="display:${advOpen ? 'block' : 'none'}">
    <details><summary class="dim" style="cursor:pointer">Advanced &middot;
      roles and permissions</summary>
      <p class="dim" style="margin-top:8px">Read-only, and nothing more. The
      warehouse stays the thing that enforces who can see what &mdash; we
      record access rules, we do not apply them.</p>
      ${families.map((f) => {
        const on = !first.family || first.family === 'none' || first.family === f;
        return `<div data-fam="${esc(f)}" style="display:${on ? 'block' : 'none'}">
          <p class="dim">${esc(GRANT_INTRO[f] ?? f)}</p>
          <pre>${esc(s.grants[f])}</pre></div>`;
      }).join('')}
    </details>
  </div>`, { script: connectScript(first.id) });
}

/**
 * Selection lives in the webview, not in a re-render.
 *
 * Every click would otherwise be a round trip to the extension host and a
 * fresh `renderConnect`, which loses the DSN the user was halfway through
 * typing. Only the primary button talks to the host.
 */
function connectScript(firstId: string): string {
  return `
  const lrows = [...document.querySelectorAll('.lrow[data-choice]')]
    .filter((el) => !el.classList.contains('off'));
  const go = document.getElementById('go');
  const dsn = document.getElementById('dsn');
  const wrap = document.getElementById('dsnwrap');
  const adv = document.getElementById('adv');
  const of = (el) => JSON.parse(el.dataset.choice);
  let sel = ${JSON.stringify(firstId)};

  // A typed connection has no family until it is recognisable, so the grants
  // appear as soon as the prefix is.
  const famOf = (t) => /^duckdb/.test(t) ? 'duckdb'
    : /^bigquery/.test(t) ? 'bigquery'
    : /^snowflake/.test(t) ? 'snowflake'
    : /^(postgres|postgresql|redshift)/.test(t) ? 'postgres' : '';

  function paint() {
    let cur;
    for (const el of lrows) {
      const c = of(el);
      const on = c.id === sel;
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) { cur = c; }
    }
    if (!cur) { return; }
    const typed = cur.kind === 'other';
    wrap.style.display = typed ? 'block' : 'none';
    const text = dsn.value.trim();
    go.textContent = cur.button;
    go.disabled = typed && !text;
    // Two selections need no grants at all and hide the section: a DuckDB
    // file, which has no roles, and an existing layer, which reads no
    // warehouse. A selection with no family YET -- the sample, or a DSN half
    // typed -- shows all three instead, because "nothing here works" is
    // exactly when someone needs them, and they must not sit behind a choice
    // the user cannot make yet.
    const fam = typed ? famOf(text) : cur.family;
    adv.style.display = fam === 'duckdb' || fam === 'layer' ? 'none' : 'block';
    const all = !fam || fam === 'none';
    for (const b of adv.querySelectorAll('[data-fam]')) {
      b.style.display = all || b.dataset.fam === fam ? 'block' : 'none';
    }
  }

  for (const el of lrows) {
    el.addEventListener('click', () => {
      sel = of(el).id; paint();
      if (of(el).kind === 'other') { dsn.focus(); }
    });
  }
  dsn.addEventListener('input', paint);
  dsn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !go.disabled) { go.click(); }
  });
  go.addEventListener('click', () => {
    const c = lrows.map(of).find((x) => x.id === sel);
    if (!c) { return; }
    if (c.kind === 'other') {
      const v = dsn.value.trim();
      if (v) { post({ type: 'use', source: v }); }
    } else if (c.kind === 'sample') {
      post({ type: 'sample' });
    } else if (c.kind === 'layer') {
      post({ type: 'layer', source: c.source });
    } else if (c.kind === 'browse') {
      post({ type: 'browse' });
    } else {
      post({ type: 'use', source: c.source });
    }
  });
  paint();`;
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
  /**
   * Which of the two installs this is.
   *
   * `nothing` — no uv and no engine, so the offer is uv.
   * `uv` — uv is here and the engine is one command away.
   *
   * The screen read the same either way, which is how a user who had just
   * installed uv could be offered uv again and conclude, fairly, that
   * nothing he did had registered.
   */
  stage?: 'nothing' | 'uv';
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
  /**
   * Open review questions, or null when the count could not be had.
   *
   * Null is not zero. Zero means every question is answered and is worth
   * showing; null means we do not know, and the panel says nothing rather
   * than claiming a clean queue it did not verify.
   */
  findings?: number | null;
  /** The checklist. Absent only on the no-engine panel, where it means nothing. */
  steps?: Steps;
  /**
   * Step one, shown in the sidebar when set.
   *
   * Set whenever there is no layer -- with nothing built, step one IS the
   * sidebar, exactly as the mock has it. There is no "Get started" panel in
   * front of it: a button labelled "Create a semantic layer" that opened a
   * screen headed "Connect to a warehouse", which then asked you to create a
   * semantic layer, named the same step twice and neither time correctly.
   *
   * Also set when a layer exists and the user clicks step one again, which is
   * how you swap the sample for a real warehouse.
   */
  connect?: ConnectState;
  /** Step two. Checked before `connect`, because it is further along. */
  scope?: ScopeState;
  /** Step three. */
  serve?: ServeState;
}

/**
 * Four sidebar destinations, and the checklist navigates between them.
 *
 * Steps two and three used to fire a command instead of opening a screen --
 * step two opened the settings editor tab, step three a quick-pick -- so two
 * of the three rows in a navigation bar did not navigate anywhere, and the
 * resting state had nothing pointing at it at all.
 */
export function renderPanel(s: PanelState): string {
  if (!s.cli) { return shell(noCli(s)); }
  if (s.scope) { return renderScope(s.scope); }
  if (s.serve) { return renderServe(s.serve); }
  if (s.connect) { return renderConnect(s.connect); }
  return shell(resting(s));
}

export interface ServeState {
  layer: string;
  clients: { label: string; state: ClientState }[];
  steps: Steps;
}

/**
 * Step three, which is the one screen that is mostly about someone else's.
 *
 * We do not own the chat panel and must not pretend to: the agent asks the
 * questions and renders the answers. What belongs here is the half we DO own
 * -- which clients on this machine can reach the layer, and the first thing
 * worth typing once one can.
 */
export function renderServe(s: ServeState): string {
  const configured = s.clients.filter((c) => c.state === 'configured');
  const present = s.clients.filter((c) => c.state === 'present');
  const q = 'What was revenue last quarter?';
  return shell(`${checklist(s.steps)}
  <div class="pad" style="padding-bottom:0">
    <p><span class="mono">${esc(s.layer)}</span> is served over MCP. Any client
    you connect reads it; nothing is copied into the client's config but a
    command.</p>
  </div>

  <h3>Clients on this machine</h3>
  ${configured.map((c) => `<div class="lrow off">
      <span class="i ok">&#10003;</span><span class="l">${esc(c.label)}</span>
      <span class="m">connected</span></div>`).join('')}
  ${present.map((c) => `<div class="lrow"
      data-msg='${esc(JSON.stringify({ type: 'client', source: c.label }))}'>
      <span class="i dim">&#9675;</span><span class="l">${esc(c.label)}</span>
      <span class="m">click to connect</span></div>`).join('')}
  ${!configured.length && !present.length
    ? '<div class="pad"><p class="dim">No MCP client found here. Claude Code, '
      + 'Cursor, Cline and Claude Desktop are the ones we can configure.</p></div>' : ''}
  ${present.length
    ? '<div class="cap">Restart the client afterwards so it picks the server up.</div>'
    : ''}

  ${configured.length ? `<h3>Then restart ${esc(configured[0].label)}</h3>
    <div class="pad" style="padding-top:0">
      <div class="note"><b>Open a new session.</b> MCP clients read their server
      list once, at startup &mdash; one that was already running when you
      connected it will not list semlayer under
      <span class="mono">/mcp</span>, and will tell you it has no data.</div>
    </div>

    <h3>Then ask it</h3>
    <div class="pad" style="padding-top:0">
      <pre style="margin-top:0">${esc(q)}</pre>
      <button class="outline" data-msg='${esc(JSON.stringify({ type: 'copy', source: q }))}'
        style="margin-top:0">Copy the question</button>
      <p class="dim">The agent calls <span class="mono">context_for_question</span>
      first, which is where routing and any competing definitions of a metric
      surface &mdash; before it writes a line of SQL.</p>
    </div>` : ''}

`);
}

function noCli(s: PanelState): string {
  const o = s.offer;
  // Nothing usable. The instruction must not assume Python: a VS Code user may
  // have none, and `uv` is a single binary that brings its own.
  const second = o?.stage === 'uv';
  return `<div class="pad">
    ${second
      ? `<p><b>uv is installed.</b> One step left: the engine itself.</p>
         <p class="dim">uv brings its own Python, so this is the last thing
         that has to be downloaded.</p>`
      : `<p>semlayer needs its engine, which is a one-time install.</p>
         <p class="dim">The extension runs the same CLI you would run in a
         terminal; it carries no engine of its own.</p>`}
    ${o ? `<pre>${esc(o.command)}</pre>
      <p class="dim">${esc(o.note)}</p>
      <button data-cmd="semlayer.install">${
        second ? 'Install the engine' : 'Run this in a terminal'}</button>
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

  return `${s.steps ? checklist(s.steps) : ''}
  <div class="row act" data-cmd="semlayer.selectLayer" title="Choose a different layer">
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
    ${configured.length ? `<p class="dim" style="margin-top:6px">A client reads
      its server list at startup. If one of these was already running when you
      connected it, start a new session before asking &mdash; it will not list
      semlayer until you do.</p>` : ''}
  </div>
  <h3>Findings</h3>
  <div class="pad" style="padding-top:0">
    ${s.findings === null || s.findings === undefined ? ''
      : s.findings === 0
        ? '<div class="row"><span class="mark ok">&#10003;</span><span class="t">Nothing open</span></div>'
        : `<div class="row act" data-cmd="semlayer.review">
             <span class="mark warn">&#9679;</span>
             <span class="t">${plural(s.findings, 'finding')}<br>
             <span class="dim">questions the engine could not settle on its own</span></span>
           </div>`}
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
    <button class="outline" data-cmd="semlayer.createLayer">Connect another warehouse</button>
    <p class="dim" style="margin-top:4px">Builds a second layer beside this one.
    Step one above goes to the same place.</p>
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

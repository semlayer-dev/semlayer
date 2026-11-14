/**
 * The states every view has to render, in one place.
 *
 * Used by both `render.test.mjs` (assertions) and `scripts/shoot.mjs`
 * (screenshots), so a state that is tested is a state that can be looked at,
 * and neither list can drift from the other.
 */

export const SETTINGS = {
  noLlm: false, model: '', noSampleEgress: false, noLlmCache: false,
  noDeclaredConstraints: false,
  llmWorkers: 4, queryWorkers: null, schema: '', name: '', out: '', manifest: '',
  context: [],
};

const client = (label, state) => ({ label, state });

// The checklist, in the three shapes the sidebar actually produces. Every row
// opens that step's screen -- the same three commands whatever the progress,
// because a navigation bar whose targets change is not one.
const CMDS = ['semlayer.createLayer', 'semlayer.createStep', 'semlayer.serve'];
const CMDS_BUILT = CMDS;
export const STEP_ONE = { step: 1, detail: ['', '', ''], cmds: CMDS };
// Day 2 is a fourth ROW, not a fourth step: it appears only once a layer
// exists, so a first run shows exactly three.
const MAINTAIN = { label: 'Maintain the layer', detail: '',
                   cmd: 'semlayer.home', current: false };
export const STEP_QUERY = {
  step: 3, detail: ['messy_mart', '36 tables', ''], cmds: CMDS_BUILT,
  maintain: MAINTAIN };
export const STEP_DONE = {
  step: 4, detail: ['messy_mart', '36 tables', 'serving Claude Code, Cline'],
  cmds: CMDS_BUILT, maintain: { ...MAINTAIN, current: true } };

export const PANEL_STATES = {
  'panel-no-cli': {
    // The machine with NOTHING: no semlayer, no uvx, no pipx, no Python. A VS
    // Code user can easily be this, and the first version of this panel told
    // them `pipx install semlayer` and stopped.
    cli: null, layer: undefined, others: 0, clients: [], drift: null,
    offer: {
      kind: 'install',
      label: 'Install uv',
      command: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
      note: 'A single binary. It brings its own Python, so nothing else is needed.',
      alternatives: [
        { label: 'Homebrew', command: 'brew install uv',
          note: 'The same binary, if you would rather not pipe a script into a shell.' },
        { label: 'With pip', command: 'pip install --user "semlayer[warehouses]"',
          note: 'If you already have Python. Installs into your user site-packages.' },
        { label: 'With pipx', command: 'pipx install "semlayer[warehouses]"',
          note: 'Also needs Python, but keeps semlayer in its own environment.' },
      ],
    },
  },
  'panel-uvx': {
    // uvx is present, so there is nothing to install -- but the first command
    // downloads the engine, and that is worth announcing before it happens.
    cli: 'semlayer', layer: undefined, others: 0, viaUvx: true,
    clients: [{ label: 'Claude Code', state: 'present' }],
    drift: null, steps: STEP_ONE,
  },
  'panel-connect': {
    // No layer, so the sidebar IS step one. There is no "Get started" panel in
    // front of it: a button reading "Create a semantic layer" that opened a
    // screen headed "Connect to a warehouse" named the same step twice.
    cli: 'semlayer', layer: undefined, others: 0, canDemo: true,
    clients: [client('Claude Code', 'present')], drift: null, steps: STEP_ONE,
  },
  'panel-connect-no-demo': {
    // The engine published as 0.7.0b2 has no `semlayer demo`, so the sample
    // row must not appear. Offering a sample that is not there is the dead
    // end this state exists to prevent.
    cli: 'semlayer', layer: undefined, others: 0, canDemo: false,
    clients: [client('Claude Code', 'present')], drift: null, steps: STEP_ONE,
  },
  'panel-resting': {
    cli: 'semlayer',
    layer: { name: 'messy_mart', tables: 36 },
    others: 0,
    clients: [client('Claude Code', 'configured'), client('Cline', 'configured'),
              client('Cursor', 'absent')],
    // The real messy_mart number: 49 undecided claims group into 20 questions,
    // and 20 is what the badge and this row both count, because 20 is how many
    // decisions there are to make.
    drift: null, findings: 20, steps: STEP_DONE,
  },
  'panel-reviewed': {
    // Every question answered. Worth showing -- it is the end state of the
    // review loop -- and distinct from "we could not get the count", which
    // shows nothing at all rather than claiming a clean queue.
    cli: 'semlayer',
    layer: { name: 'messy_mart', tables: 36 },
    others: 0,
    clients: [client('Claude Code', 'configured')],
    drift: null, findings: 0, steps: STEP_DONE,
  },
  'panel-drift': {
    cli: 'semlayer',
    layer: { name: 'messy_mart', tables: 36 },
    others: 2,
    clients: [client('Claude Code', 'configured'), client('Cline', 'present')],
    drift: '2 new tables, 1 column change', steps: STEP_DONE,
  },
  'panel-one-table': {
    // "1 tables" was waiting to happen; this state is here to stop it.
    cli: 'semlayer', layer: { name: 'tiny', tables: 1 }, others: 0,
    clients: [], drift: null,
    steps: { step: 3, detail: ['tiny', '1 table', ''], cmds: CMDS_BUILT },
  },
};

export const PROBE = {
  tables: 36, columns: 198, schemas: 1,
  declared_pk_ratio: 0, declared_fk_ratio: 0, has_manifest: false, grade: 'weak',
};

/** Step three: one client connected, one here but not wired up yet. */
export const SERVE = {
  layer: 'messy_mart',
  clients: [client('Claude Code', 'configured'), client('Cline', 'present'),
            client('Cursor', 'absent')],
  steps: STEP_QUERY,
};

/** Step three before any client is connected: nothing to ask yet. */
export const SERVE_NONE = {
  layer: 'messy_mart',
  clients: [client('Cline', 'present')],
  steps: STEP_QUERY,
};

/** Step two: a warehouse has been read, step one is done, nothing spent yet. */
export const SCOPE = {
  probe: PROBE,
  source: 'duckdb:messy_mart.duckdb',
  settings: SETTINGS,
  steps: { step: 2, detail: ['duckdb:messy_mart.duckdb', '', ''], cmds: CMDS },
};

export const DRIFT = {
  events: [
    { kind: 'table_added', table: 'sub_evt', column: null, detail: '' },
    { kind: 'table_added', table: 'web_evt', column: null, detail: '' },
    { kind: 'column_added', table: 'ord_hdr', column: 'curr_cd', detail: 'VARCHAR' },
  ],
  orphaned: [],
  needs_inference: ['sub_evt', 'web_evt', 'ord_hdr'],
  affected: ['metrics.sub_evt_count', 'ord_hdr.curr_cd'],
  broken_cqs: [],
};

const q = (over) => ({
  n: 1, key: 'q-0000', kind: 'low_confidence',
  claim: 'holds the display name of the row; grouped by (type name)',
  engine_saw: 'the column name ends in _name',
  confidence: 0.65, count: 20,
  objects: [{ where: 'category_dim.category_nm', table: 'category_dim',
              column: 'category_nm', evidence: 'name rule -> name' }],
  on_accept: 'keeps the type, marked reviewed',
  on_reject: 'clears the type; the column stays, untyped',
  set_accepts: '<semantic_type>/<entity_role>',
  ...over,
});

export const QUEUE = {
  document: 'messy_mart',
  undecided_items: 49,
  questions: [
    q({ n: 1, key: 'q-4bb1485d' }),
    q({
      n: 2, key: 'q-7f02a1c4', kind: 'discovered_filter', confidence: null, count: 1,
      claim: "total_tot_amt applies sts_cd <> 'X' — a rule nobody declared",
      engine_saw: "business rule from aggregate reconciliation: sts_cd <> 'X'",
      objects: [{ where: 'metrics.total_tot_amt', table: 'ord_hdr', column: null,
                  evidence: 'reconciles with dly_sls_agg under this filter' }],
      on_accept: 'the rule becomes a required filter on the table',
      on_reject: 'the rule is removed from the metric and the table',
    }),
    q({
      n: 3, key: 'q-2b61de90', kind: 'aggregate_mapping', confidence: null, count: 1,
      claim: "dly_sls_agg is SUM(tot_amt) WHERE sts_cd <> 'X' grouped by agg_dt_key, store_id",
      engine_saw: 'reconciles per-group with ord_hdr.tot_amt',
      on_accept: 'keeps the mapping, marked reviewed',
      on_reject: 'deprecates the mapping; the table is no longer routed to',
    }),
    q({ n: 4, key: 'q-c13a297b', confidence: 0.4, count: 3 }),
  ],
};

export const QUEUE_EMPTY = { document: 'messy_mart', undecided_items: 49, questions: [] };

export const GRANT_SNOWFLAKE = `CREATE ROLE IF NOT EXISTS semlayer_reader;
GRANT USAGE ON DATABASE MESSY_MART TO ROLE semlayer_reader;
GRANT SELECT ON ALL TABLES IN DATABASE MESSY_MART TO ROLE semlayer_reader;`;

/**
 * The other two families, abridged the same way GRANT_SNOWFLAKE is.
 *
 * They exist so the connect screen can be rendered with all three in hand: the
 * point of that screen's Advanced section is that it shows the ONE family you
 * selected, which cannot be tested with a single script.
 */
export const GRANT_BIGQUERY = `PROJECT=<your_project>
gcloud projects add-iam-policy-binding $PROJECT \\
  --member="serviceAccount:semlayer-reader@$PROJECT.iam.gserviceaccount.com" \\
  --role="roles/bigquery.dataViewer"`;

export const GRANT_POSTGRES = `CREATE ROLE semlayer_reader LOGIN PASSWORD '<set-a-strong-password>';
GRANT CONNECT ON DATABASE <your_database> TO semlayer_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA <your_schema> TO semlayer_reader;`;

export const GRANTS = {
  snowflake: GRANT_SNOWFLAKE, bigquery: GRANT_BIGQUERY, postgres: GRANT_POSTGRES,
};

/** A layer already committed to the workspace -- the connect screen's top row. */
export const WORKSPACE_LAYER = {
  file: 'messy_mart.yaml',
  path: '/home/you/acme/messy_mart.yaml',
  meta: '36 tables · built 4 weeks ago',
};

/**
 * `semlayer discover --json`, copied from real runs rather than invented.
 *
 * The unsupported Snowflake row is verbatim from a machine with
 * SNOWFLAKE_ACCOUNT set and nothing else -- which is the common half-configured
 * state, and the note is the part that earns the screen its place.
 */
export const CONNECTIONS = [
  { uri: 'duckdb:messy_mart.duckdb', kind: 'duckdb', source: 'working directory',
    supported: true, note: null },
  { uri: 'snowflake:analytics_prod', kind: 'snowflake',
    source: 'connections.toml', supported: true, note: null },
  { uri: 'snowflake', kind: 'snowflake', source: 'environment: SNOWFLAKE_ACCOUNT',
    supported: false,
    note: 'account from SNOWFLAKE_ACCOUNT; add SNOWFLAKE_READER_USER=<user>; '
        + 'SNOWFLAKE_READER_PRIVATE_KEY_PATH=<path to the .p8 key>; '
        + 'SNOWFLAKE_DATABASE=<database> to ~/.semlayer/.env',
  },
];

/**
 * The connect screen, in the three shapes that change its structure: a repeat
 * visit (a layer is already here), a first run on a machine with nothing, and
 * an engine too old to have `semlayer demo`.
 */
export const CONNECT = {
  conns: CONNECTIONS, layers: [WORKSPACE_LAYER], canDemo: true,
  grants: GRANTS, canCancel: true, steps: STEP_ONE,
};

export const CONNECT_EMPTY = {
  conns: [], layers: [], canDemo: true, grants: GRANTS, canCancel: false,
  steps: STEP_ONE,
};

export const CONNECT_NO_DEMO = {
  conns: CONNECTIONS.slice(0, 1), layers: [], canDemo: false,
  grants: GRANTS, canCancel: false, steps: STEP_ONE,
};

/**
 * A panel state with its connect screen attached, the way `Panel.refresh`
 * builds it.
 *
 * A function, not more constants, because the connect fixtures are defined
 * below PANEL_STATES and reading them at module scope would hit the temporal
 * dead zone. It also encodes the production invariant worth keeping true in
 * the fixtures: an engine with no layer always has step one in the sidebar.
 */
export function panelState(name) {
  const s = PANEL_STATES[name];
  if (!s.cli || s.layer) { return s; }
  const base = name === 'panel-connect-no-demo' ? CONNECT_NO_DEMO : CONNECT_EMPTY;
  // viaUvx is carried onto the connect screen because that is where the notice
  // is now rendered -- it used to be on the "Get started" panel that step one
  // replaced.
  return { ...s, connect: { ...base, viaUvx: s.viaUvx ?? false } };
}

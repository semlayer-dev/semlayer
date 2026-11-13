/**
 * The states every view has to render, in one place.
 *
 * Used by both `render.test.mjs` (assertions) and `scripts/shoot.mjs`
 * (screenshots), so a state that is tested is a state that can be looked at,
 * and neither list can drift from the other.
 */

export const SETTINGS = {
  noLlm: false, noSampleEgress: false, noLlmCache: false, noDeclaredConstraints: false,
  llmWorkers: 4, queryWorkers: null, schema: '', name: '', manifest: '', context: [],
  openPr: false,
};

const client = (label, state) => ({ label, state });

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
    drift: null,
  },
  'panel-walkthrough': {
    cli: 'semlayer', layer: undefined, others: 0, canDemo: true,
    clients: [client('Claude Code', 'present')], drift: null,
  },
  'panel-walkthrough-no-demo': {
    // The engine published as 0.7.0b2 has no `semlayer demo`, so the sample
    // button must not appear. Offering a sample that is not there is the dead
    // end this state exists to prevent.
    cli: 'semlayer', layer: undefined, others: 0, canDemo: false,
    clients: [client('Claude Code', 'present')], drift: null,
  },
  'panel-resting': {
    cli: 'semlayer',
    layer: { name: 'messy_mart', tables: 36 },
    others: 0,
    clients: [client('Claude Code', 'configured'), client('Cline', 'configured'),
              client('Cursor', 'absent')],
    drift: null,
  },
  'panel-drift': {
    cli: 'semlayer',
    layer: { name: 'messy_mart', tables: 36 },
    others: 2,
    clients: [client('Claude Code', 'configured'), client('Cline', 'present')],
    drift: '2 new tables, 1 column change',
  },
  'panel-one-table': {
    // "1 tables" was waiting to happen; this state is here to stop it.
    cli: 'semlayer', layer: { name: 'tiny', tables: 1 }, others: 0,
    clients: [], drift: null,
  },
};

export const PROBE = {
  tables: 36, columns: 198, schemas: 1,
  declared_pk_ratio: 0, declared_fk_ratio: 0, has_manifest: false, grade: 'weak',
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

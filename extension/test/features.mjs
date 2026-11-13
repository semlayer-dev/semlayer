/**
 * The feature manifest.
 *
 * One list of everything this extension claims to do, each entry carrying the
 * evidence for it. A feature that is not here does not count as built, and a
 * feature here whose evidence fails is not built either.
 *
 * `kind` says what the assertion looks at:
 *   contributes  a command, setting or walkthrough step declared in package.json
 *   logic        a pure function, asserted in a unit test
 *   render       a webview state that renders and contains what it must
 *   cli          a real `semlayer` invocation whose output shape is asserted
 *   gap          designed, deliberately NOT built, with the reason
 *
 * Gaps are first-class. The point of writing them down is that "we decided not
 * to" and "we forgot" stop looking the same in a month.
 */

export const FEATURES = [
  // --- connect -------------------------------------------------------------
  { id: 'connect.ask', kind: 'contributes', command: 'semlayer.createLayer',
    what: 'Ask for a warehouse to read' },
  { id: 'connect.grants', kind: 'contributes', command: 'semlayer.grants',
    what: 'Show the minimal read-only grants this warehouse needs' },
  { id: 'connect.grants.perFamily', kind: 'render', view: 'grants-snowflake',
    contains: ['CREATE ROLE'], what: 'Grants differ per warehouse family' },
  { id: 'connect.grants.duckdb', kind: 'render', view: 'grants-duckdb',
    contains: ['No grants needed'],
    what: 'A DuckDB file has no grants, and the screen says so instead of showing SQL' },
  { id: 'connect.discovery', kind: 'gap',
    what: 'List warehouse connections found on this machine',
    why: 'No CLI verb does this; discover_connections is an MCP tool only.' },

  // --- create --------------------------------------------------------------
  { id: 'create.scope', kind: 'cli', verb: 'probe',
    what: 'Read what the warehouse offers before inferring' },
  { id: 'create.cost', kind: 'render', view: 'scope',
    contains: ['estimated', 'Nothing has been read or spent yet'],
    what: 'Show time and money before anything is spent' },
  { id: 'create.evidence', kind: 'render', view: 'scope',
    contains: ['Declared foreign keys', 'weak'],
    what: 'Show what evidence exists and what accuracy follows' },
  { id: 'create.deterministic', kind: 'render', view: 'scope-deterministic',
    contains: ['$0.00', 'no descriptions are written'],
    what: 'Deterministic mode is free and says what it costs you instead' },
  { id: 'create.settings', kind: 'contributes', command: 'semlayer.settings',
    what: 'Every inference flag as a form' },
  { id: 'create.settings.privacy', kind: 'render', view: 'settings',
    contains: ['Never send cell values'],
    what: 'Cell-value egress is a labelled privacy control' },
  { id: 'create.settings.scope', kind: 'render', view: 'settings',
    contains: ['Only this schema', 'dbt manifest', 'Knowledge docs'],
    what: 'Schema scoping, dbt manifest and knowledge docs are settable' },
  { id: 'create.settings.command', kind: 'render', view: 'settings',
    contains: ['semlayer infer'],
    what: 'The settings form shows the command it will run' },
  { id: 'create.settings.args', kind: 'logic',
    what: 'Settings translate to the real flag spellings' },
  { id: 'create.model', kind: 'gap', what: 'Choose a model',
    why: 'The model is a constant in the engine with no flag and no env override.' },
  { id: 'create.sample', kind: 'render', view: 'panel-walkthrough',
    contains: ['sample warehouse', 'No credentials, no API key'],
    what: 'A warehouse to try it on, for someone who has none' },
  { id: 'create.sample.gated', kind: 'render', view: 'panel-walkthrough-no-demo',
    absent: ['sample warehouse'],
    what: 'The sample is offered only when the installed engine actually has it' },
  { id: 'create.sample.cli', kind: 'cli', verb: 'demo',
    what: 'The sample warehouse comes from the engine, so a pip install has it too' },

  // --- lint ----------------------------------------------------------------
  { id: 'lint.onOpen', kind: 'contributes', setting: 'semlayer.lint.enable',
    what: 'Check SQL on open and on save' },
  { id: 'lint.onType', kind: 'contributes', setting: 'semlayer.lint.onType',
    what: 'Check while typing, debounced' },
  { id: 'lint.dialect', kind: 'contributes', setting: 'semlayer.dialect',
    what: 'Any SQL dialect, with no warehouse connection' },
  { id: 'lint.positions', kind: 'logic',
    what: 'Findings land on the right identifier despite carrying no source offset' },
  { id: 'lint.cli', kind: 'cli', verb: 'lint',
    what: 'Findings come from the same linter the CLI runs' },

  // --- review --------------------------------------------------------------
  { id: 'review.screen', kind: 'contributes', command: 'semlayer.review',
    what: 'Review as a two-pane screen, not a prompt loop' },
  { id: 'review.consequences', kind: 'render', view: 'review',
    contains: ['If you accept', 'If you reject'],
    what: 'Both consequences are visible before the click' },
  { id: 'review.stakes', kind: 'logic',
    what: 'Questions that change an answer sort above naming and typing' },
  { id: 'review.bulk', kind: 'render', view: 'review', contains: ['Accept all'],
    what: 'The low-stakes majority can be accepted in one action' },
  { id: 'review.empty', kind: 'render', view: 'review-empty',
    contains: ['Every question is answered'],
    what: 'An empty queue is a sentence, not a blank pane' },
  { id: 'review.cli', kind: 'cli', verb: 'review',
    what: 'The queue and the verdicts are the CLI’s' },

  // --- serve ---------------------------------------------------------------
  { id: 'serve.configure', kind: 'contributes', command: 'semlayer.configureClient',
    what: 'Write an MCP client’s config' },
  { id: 'serve.states', kind: 'render', view: 'panel-resting',
    contains: ['MCP clients'],
    what: 'Which clients can see the layer, and which cannot' },

  // --- day 2 ---------------------------------------------------------------
  { id: 'day2.resting', kind: 'render', view: 'panel-resting',
    contains: ['Findings', 'Maintenance'],
    what: 'The walkthrough is replaced by a resting state once a layer exists' },
  { id: 'day2.drift', kind: 'contributes', command: 'semlayer.drift',
    what: 'Detect what moved in the warehouse' },
  { id: 'day2.drift.summary', kind: 'render', view: 'panel-drift',
    contains: ['new tables', 'See what changed'],
    what: 'Drift is one line in the sidebar before it is a screen' },
  { id: 'day2.drift.detail', kind: 'render', view: 'drift',
    contains: ['Re-infer', 'Verdicts you already recorded survive'],
    what: 'Re-inference is targeted and keeps recorded verdicts' },
  { id: 'day2.drift.quiet', kind: 'logic',
    what: 'No drift reads as calm, not as a parse failure' },
  { id: 'day2.stitch', kind: 'contributes', command: 'semlayer.stitch',
    what: 'Stitch several layers into a hub' },
  { id: 'day2.stitch.conditional', kind: 'render', view: 'panel-resting',
    absent: ['Stitch'],
    what: 'Stitch stays hidden until the workspace holds more than one layer' },
  { id: 'day2.cli.drift', kind: 'cli', verb: 'drift', what: 'Drift comes from the CLI' },

  // --- the extension itself ------------------------------------------------
  { id: 'meta.noCli', kind: 'render', view: 'panel-no-cli',
    contains: ['astral.sh/uv', 'one-time install'], absent: ['was not found on your PATH'],
    what: 'A machine with no Python is given a bootstrap that needs no Python' },
  { id: 'meta.noCli.alternatives', kind: 'render', view: 'panel-no-cli',
    contains: ['brew install uv', 'pip install --user', 'pipx install'],
    what: 'Other install routes: pip and pipx at equal weight, not one buried under the other' },
  { id: 'meta.noCli.recheck', kind: 'render', view: 'panel-no-cli',
    contains: ['Check again', 'nothing needs restarting'],
    what: 'A way forward after an install finishes, in the panel itself' },
  { id: 'meta.noCli.pointAtIt', kind: 'render', view: 'panel-no-cli',
    contains: ['If you already installed semlayer', 'set the path',
               'did not find it', 'Set the path'],
    absent: ['Already installed somewhere', 'I already have it'],
    what: 'A conditional, saying plainly what was looked for and what to set' },
  { id: 'meta.openSetting', kind: 'contributes', command: 'semlayer.openSetting',
    what: 'Open the one setting, rather than naming it and leaving you to find it' },
  { id: 'meta.recheck', kind: 'contributes', command: 'semlayer.recheck',
    what: 'Re-detect the engine without reloading' },
  { id: 'meta.noCli.visible', kind: 'render', view: 'panel-no-cli',
    contains: ['Run this in a terminal', 'see exactly what runs'],
    what: 'The install command is shown in full and runs where you can watch it' },
  { id: 'meta.uvx', kind: 'render', view: 'panel-uvx',
    contains: ['uvx', 'a minute or two'],
    what: 'Running through uvx is announced, with an honest first-run cost' },
  { id: 'meta.cliArgs', kind: 'logic',
    what: 'cliPath takes a command with arguments, so uvx can be pointed at' },
  { id: 'meta.install', kind: 'contributes', command: 'semlayer.install',
    what: 'Install the engine from the panel' },
  { id: 'meta.walkthrough', kind: 'contributes', walkthrough: 'semlayer.setup',
    what: 'A walkthrough that completes its own steps' },
  { id: 'meta.firstRun', kind: 'render', view: 'panel-walkthrough',
    contains: ['Get started', 'Create a semantic layer'], absent: ['Findings', 'Maintenance'],
    what: 'With no layer the sidebar is the walkthrough and nothing else' },
  { id: 'meta.firstRun.cta', kind: 'render', view: 'panel-walkthrough',
    absent: ['Connect to a warehouse', 'Try a sample'],
    what: 'The button is the first step, and no step promises what does not exist' },
  { id: 'meta.plural.render', kind: 'render', view: 'panel-one-table',
    contains: ['1 table'], absent: ['1 tables'],
    what: 'A one-table layer reads as "1 table" in the sidebar' },
  { id: 'meta.cliPath', kind: 'contributes', setting: 'semlayer.cliPath',
    what: 'Point at an engine that is not on PATH' },
  { id: 'meta.plural', kind: 'logic', what: 'Counts read correctly at one' },
  { id: 'meta.tableCount', kind: 'logic',
    what: 'Table counts come from the tables block, not from indentation' },
  { id: 'meta.export', kind: 'gap', what: 'Export to dbt, LookML or Cube',
    why: 'There is no `semlayer export` subcommand; export is an MCP tool only.' },
];

export const byKind = (k) => FEATURES.filter((f) => f.kind === k);

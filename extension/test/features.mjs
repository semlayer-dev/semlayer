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
    what: 'Open step one: which warehouse to read' },
  { id: 'connect.screen', kind: 'render', view: 'connect',
    contains: ['Connect to a warehouse', 'Layer in this workspace',
               'Or start from a warehouse', 'roles and permissions'],
    what: 'Step one is a screen listing what this machine can reach, not an input box' },
  { id: 'connect.screen.empty', kind: 'render', view: 'connect-empty',
    contains: ['No warehouse connections found', 'Start from a warehouse',
               'Sample warehouse'],
    what: 'With nothing found, the screen still offers a route forward' },
  { id: 'connect.blocked.reason', kind: 'render', view: 'connect',
    contains: ['SNOWFLAKE_READER_USER'],
    what: 'A half-configured connection names what it is missing, inline' },
  { id: 'connect.grants.reachable', kind: 'render', view: 'connect-empty',
    contains: ['Snowflake', 'BigQuery', 'Postgres', 'id="adv" style="display:block"'],
    what: 'The grant scripts are reachable with NO working connection -- which '
        + 'is when they are needed. Previously only a failed probe opened them, '
        + 'and then a `display:none` hid them on the very screen that is shown '
        + 'to a machine with nothing configured.' },
  { id: 'connect.screen.noSample', kind: 'render', view: 'connect-no-demo',
    contains: ['Connect something else', 'Open an existing layer file'],
    absent: ['Sample warehouse'],
    what: 'An engine without `demo` is offered no sample button -- a button for '
        + 'a command that is not there was the original dead end' },

  // The FORM of step one, which is the part that was wrong rather than missing.
  // The first build of this screen listed the same options as a stack of
  // buttons; `beta/ux/design-prompt.md` rules that out by name, and these four
  // keep it from coming back.
  { id: 'connect.form.list', kind: 'render', view: 'connect',
    contains: ['class="lrow', 'aria-selected="false"'],
    what: 'Every option is a selectable list row, not a button of its own' },
  { id: 'connect.form.onePrimary', kind: 'render', view: 'connect',
    contains: ['<button id="go"'],
    what: 'One primary button, named for whatever row is selected' },
  { id: 'connect.form.dsnInline', kind: 'render', view: 'connect',
    contains: ['id="dsn"', 'id="dsnwrap"'],
    what: 'A typed connection is entered on this screen, under the row that '
        + 'asks for it -- not in a modal that closes the list' },
  { id: 'connect.form.grantsFollowSelection', kind: 'render', view: 'connect',
    contains: ['data-fam="snowflake"', 'data-fam="bigquery"', 'data-fam="postgres"'],
    what: 'The Advanced section shows the grants for the SELECTED row, so a '
        + 'DuckDB file is offered none at all' },
  { id: 'connect.steps', kind: 'render', view: 'connect',
    contains: ['Connect to a warehouse', 'Create the semantic layer',
               'Query your warehouse'],
    what: 'The three steps are visible on step one, as a checklist that ticks' },
  { id: 'connect.sidebar', kind: 'logic',
    what: 'Step one renders in the sidebar panel, not as an editor tab' },
  { id: 'connect.again', kind: 'render', view: 'panel-resting',
    contains: ['Connect another warehouse'],
    what: 'A layer already built does not trap you on it' },
  { id: 'connect.grants', kind: 'contributes', command: 'semlayer.grants',
    what: 'Show the minimal read-only grants this warehouse needs' },
  { id: 'connect.grants.perFamily', kind: 'render', view: 'grants-snowflake',
    contains: ['CREATE ROLE'], what: 'Grants differ per warehouse family' },
  { id: 'connect.grants.duckdb', kind: 'render', view: 'grants-duckdb',
    contains: ['No grants needed'],
    what: 'A DuckDB file has no grants, and the screen says so instead of showing SQL' },
  { id: 'connect.discovery', kind: 'cli', verb: 'discover',
    what: 'List warehouse connections found on this machine' },

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
  { id: 'create.sidebar', kind: 'logic',
    what: 'Step two renders in the sidebar, where step one was' },
  { id: 'create.settings.inline', kind: 'render', view: 'scope',
    contains: ['Advanced', 'Never send cell values to the model', 'semlayer infer'],
    what: 'The settings are collapsed INSIDE Create, not a third screen -- and '
        + 'they are the same component Day 2 reopens' },
  { id: 'create.back', kind: 'render', view: 'scope',
    contains: ['Pick a different warehouse'],
    what: 'Step two can go back to step one without starting over' },
  { id: 'create.running', kind: 'render', view: 'scope-running',
    contains: ['class="bar"', 'resumes from cache'],
    absent: ['Pick a different warehouse'],
    what: 'The run happens ON step two. Leaving for it sent the sidebar back '
        + 'to step one, so Create appeared to undo itself and the run the user '
        + 'had just authorised went on somewhere they could not see.' },
  { id: 'create.steps.navigable', kind: 'render', view: 'scope',
    contains: ['step act done', 'data-cmd="semlayer.createLayer"'],
    what: 'A finished step is a link back to that step' },
  { id: 'create.settings', kind: 'contributes', command: 'semlayer.settings',
    what: 'Every inference flag as a form. Day 2 reopens the SAME screen -- '
        + 'it had a second one of its own, which both duplicated the form and '
        + 'asked for a warehouse the layer already names.' },
  { id: 'create.settings.privacy', kind: 'render', view: 'scope',
    contains: ['Never send cell values'],
    what: 'Cell-value egress is a labelled privacy control' },
  { id: 'create.settings.scope', kind: 'render', view: 'scope',
    contains: ['Only this schema', 'dbt manifest', 'Knowledge docs'],
    what: 'Schema scoping, dbt manifest and knowledge docs are settable' },
  { id: 'create.settings.command', kind: 'render', view: 'scope',
    contains: ['semlayer infer'],
    what: 'The settings form shows the command it will run' },
  { id: 'create.settings.args', kind: 'logic',
    what: 'Settings translate to the real flag spellings' },
  { id: 'create.settings.live', kind: 'logic',
    what: 'Every setting in the form changes the command that runs. An "Open a '
        + 'pull request" checkbox sat here with no flag, no reader and no verb '
        + 'behind it, and nothing caught it: the audit checks that claims have '
        + 'evidence, never that a control has a claim.' },
  { id: 'create.settings.model', kind: 'render', view: 'scope-settings',
    contains: ['>Model<', 'claude-haiku-4-5-20251001'],
    what: 'The model is choosable, with the default named and the estimate marked '
        + 'as priced on it. It was a constant in the engine with no flag; '
        + '`--model` and SEMLAYER_MODEL landed for this field.' },
  { id: 'create.settings.model.cli', kind: 'cli', verb: 'infer', flag: '--model',
    what: 'The engine takes the model, so the CLI and the MCP server have the '
        + 'same choice this form does' },
  { id: 'create.settings.out', kind: 'render', view: 'scope-settings',
    contains: ['Write to', '.yaml'],
    what: 'The output file is nameable, with the engine default spelled out -- '
        + 'otherwise the only way to know where the layer landed was to watch '
        + 'for a new file' },
  { id: 'create.settings.reopen', kind: 'render', view: 'scope-settings',
    contains: ['<details style="margin-top:14px" open>'],
    what: 'Asking for the settings by name ("Rebuild with settings") lands on '
        + 'step two with them already open, instead of on the step with them '
        + 'folded away' },
  { id: 'create.sample', kind: 'render', view: 'panel-connect',
    contains: ['Sample warehouse', 'no credentials, no API key'],
    what: 'A warehouse to try it on, for someone who has none' },
  { id: 'create.sample.gated', kind: 'render', view: 'panel-connect-no-demo',
    absent: ['Sample warehouse'],
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
  { id: 'review.count', kind: 'render', view: 'panel-resting',
    contains: ['20 findings', 'could not settle on its own'],
    what: 'The open count is in the sidebar, and the row is the way into the '
        + 'queue. The panel said only "Review findings", with no number, so '
        + 'nothing said whether there was anything there' },
  { id: 'review.count.none', kind: 'render', view: 'panel-reviewed',
    contains: ['Nothing open'], absent: ['could not settle on its own'],
    what: 'An answered queue says so. A count that could not be had shows '
        + 'nothing instead, because a badge reading 0 over 20 open questions '
        + 'is worse than no badge' },
  { id: 'review.badge', kind: 'logic',
    what: 'The open count is a badge on the activity-bar icon -- the one place '
        + 'this extension can say "there is something here" while the user is '
        + 'looking at their code' },

  // --- serve ---------------------------------------------------------------
  { id: 'serve.screen', kind: 'render', view: 'serve',
    contains: ['Clients on this machine', 'Then ask it',
               'What was revenue last quarter?', 'context_for_question'],
    what: 'Step three is a screen like the other two: which clients can reach '
        + 'the layer, and the first thing worth typing once one can' },
  { id: 'serve.restart', kind: 'render', view: 'serve',
    contains: ['Then restart', 'Open a new session', 'at startup', '/mcp'],
    what: 'Restarting the client is a STEP on this screen, named after the '
        + 'client. It was a dim caption shown only while an unconnected client '
        + 'remained -- so it disappeared the moment you connected your last '
        + 'one, which is exactly when it starts to matter. A user connected '
        + 'Claude Code, ran /mcp, saw nothing, and was told by the agent that '
        + 'it had no data.' },
  { id: 'serve.noClient', kind: 'render', view: 'serve-none',
    absent: ['Then ask it'],
    what: 'With nothing connected there is nothing to ask yet, so the screen '
        + 'does not pretend otherwise' },
  { id: 'serve.home', kind: 'render', view: 'serve',
    contains: ['Maintain the layer', 'semlayer.home'],
    what: 'Day 2 is reachable from every step. It was a button at the bottom '
        + 'of each screen, which is three places to look; it is now a fourth '
        + 'row under the checklist, below a rule because it is not a step' },
  { id: 'serve.configure', kind: 'contributes', command: 'semlayer.configureClient',
    what: 'Write an MCP client’s config' },
  { id: 'serve.configure.runnable', kind: 'logic',
    what: 'The config names an absolute command and keeps its arguments as '
        + 'arguments. It wrote the whole argv joined into `command`, and a '
        + 'bare `semlayer` whenever no route was resolved -- the client is a '
        + 'different process with a different PATH, and a user got '
        + '`executable not found` from an agent that then said it had no data.' },
  { id: 'serve.configure.honest', kind: 'logic',
    what: 'A config naming a command this machine does not have reads as NOT '
        + 'connected, so the panel offers to write it again instead of '
        + 'claiming a connection that cannot start' },
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
  { id: 'build.prepublish', kind: 'logic',
    what: 'Packaging compiles first. `vsce package` run on its own ships '
        + 'whatever dist/ already holds, and did: a bundle hours older than '
        + 'the code, while every test here passed because they read out/, '
        + 'which tsc had just rebuilt.' },
  { id: 'meta.noCli', kind: 'render', view: 'panel-no-cli',
    contains: ['astral.sh/uv', 'tool install', 'one-time install'],
    absent: ['was not found on your PATH'],
    what: 'A machine with no Python is given a bootstrap that needs no Python, '
        + 'and it is ONE step: uv and the engine in a single command. Asking '
        + 'twice was an artifact of modelling what is missing rather than what '
        + 'the user came for -- uv is not a thing anyone wants' },
  { id: 'meta.noCli.alternatives', kind: 'render', view: 'panel-no-cli',
    contains: ['brew install uv', 'pip install --user', 'pipx install'],
    what: 'Other install routes: pip and pipx at equal weight, not one buried under the other' },
  { id: 'meta.haveUv', kind: 'render', view: 'panel-have-uv',
    contains: ['uv is installed', 'One step left', 'uv tool install',
               'Install the engine'],
    absent: ['astral.sh/uv', 'brew install uv'],
    what: 'With uv present the panel offers the ENGINE, not uv again. The '
        + 'resolver always said so and the panel discarded it, always showing '
        + 'installers()[0] -- so a user who had just installed uv was offered '
        + 'uv a second time and a third' },
  { id: 'meta.install.offered', kind: 'logic',
    what: 'The install button runs the command the panel is OFFERING. It ran '
        + 'installers()[0] regardless, so "Install the engine" installed uv a '
        + 'second time and uv\u2019s own script signed off with '
        + '"everything\u2019s installed!" while there was still no engine.' },
  { id: 'meta.stage', kind: 'logic',
    what: 'Three stages, not a yes/no: nothing, uv, engine. Check again and '
        + 'the install watcher both asked "is there an engine?" and so called '
        + 'the middle state failure -- "Still no engine ... press Check again" '
        + 'on the one press that had just succeeded' },
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
  { id: 'meta.firstRun', kind: 'render', view: 'panel-connect',
    contains: ['Connect to a warehouse', 'Start from a warehouse'],
    absent: ['Findings', 'Maintenance', 'Get started'],
    what: 'With no layer the sidebar IS step one -- no panel in front of it' },
  { id: 'meta.firstRun.cta', kind: 'render', view: 'panel-connect',
    absent: ['>Create a semantic layer<'],
    what: 'Nothing on step one is labelled "Create a semantic layer". That '
        + 'button opened a screen headed "Connect to a warehouse" which then '
        + 'asked you to create a semantic layer -- the same step named twice, '
        + 'and neither time correctly.' },
  { id: 'meta.screen', kind: 'logic',
    what: 'Every navigation lands, whatever screen is already up. The sidebar '
        + 'used to hold three independent flags read in priority order, so a '
        + 'click that set one without clearing the others did nothing at all.' },
  { id: 'meta.steps.persist', kind: 'render', view: 'panel-resting',
    contains: ['Connect to a warehouse', 'Create the semantic layer',
               'Query your warehouse'],
    what: 'The three steps stay visible once done, because they are the only '
        + 'way back: swapping the sample for a real warehouse is step one '
        + 'again, and a checklist that removes itself removes that route' },
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
  { id: 'share.pr', kind: 'gap', what: 'Open a pull request with the layer',
    why: 'What opens a PR today is examples/maintain/semlayer-maintain.yml, a '
       + 'workflow that runs nightly IN the repo that holds the layer and '
       + 'pushes to one standing branch. The extension could offer to install '
       + 'that template; it cannot open a PR itself without taking on git auth, '
       + 'remotes and workspaces that are not repositories. A checkbox that '
       + 'claimed this was here and did nothing; it was removed.' },
];

export const byKind = (k) => FEATURES.filter((f) => f.kind === k);

# Changelog

## 0.1.0

First release.

**Three steps, in the sidebar.** Connect a warehouse, create the semantic
layer, query it from an MCP client. The steps stay visible once done, because
swapping the sample warehouse for a real one is step one again, and each is a
link back to that screen.

- **Connect** lists what this machine can already reach — DuckDB files in the
  folder you opened, `connections.toml` profiles, dbt targets, environment
  variables — with the minimal read-only grant script for the warehouse you
  pick, and a sample warehouse for anyone who has none. A half-configured
  connection says what it is missing rather than being hidden.
- **Create** shows what the warehouse offers and what the run will cost and
  take, before anything is spent. Every inference setting is here, including
  the model and where the layer file is written, with the exact
  `semlayer infer` command it builds.
- **Query** writes the MCP config for Claude Code, Cline, Cursor or Claude
  Desktop, and tells you to start a new session of that client — they read
  their server list once, at startup.

**With nothing installed, one button.** uv and the engine in a single
command. uv brings its own Python, so no Python is required.

**SQL diagnostics from `semlayer lint`**, on open, on save and while you
type. The findings that matter are the two that execute cleanly and return a
wrong number: a join that fans out an aggregate, and a required filter nobody
declared.

**Day 2**: what drifted in the warehouse since the layer was built, the
review queue with both consequences shown before you click, and the open
count as a badge on the activity-bar icon.

Diagnostic ranges are exact, taken from the engine's parser rather than
reconstructed by searching the SQL. With an engine older than 0.7.0b6 the
whole first line of the statement is underlined instead.

One known gap, in the engine rather than here: there is no `semlayer export`
subcommand yet, so exporting to dbt is available only to an agent over MCP.
The command is absent rather than present and broken.

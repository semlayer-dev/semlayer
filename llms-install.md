# Installing semlayer as an MCP server

For an AI agent setting this up on a user's machine. Everything needed is on
this page; nothing here requires reading another file.

## What it is

semlayer reads a data warehouse and writes the semantic layer an agent needs
to query it correctly — table and column meanings, the foreign keys nobody
declared, which columns are measures, the filters that must always be
applied. It then serves that over MCP, and can run SQL against the warehouse.

## Prerequisite

`uv` (from [uv](https://docs.astral.sh/uv/)). Check with `uv --version`. If
absent: `curl -LsSf https://astral.sh/uv/install.sh | sh`.

## Step one: install the engine

```bash
uv tool install --python 3.13 "semlayer[warehouses]"
```

Do this **before** writing the config, and do not skip it in favour of
pointing the client at `uvx`. Running the server through `uvx` makes the
client's first launch fetch a Python and about sixty-five packages, which
takes minutes; most clients give up and report the server as failed, and the
user sees `executable not found` or a dead server rather than a download in
progress. Installing first makes startup instant and makes upgrades explicit
(`uv tool upgrade semlayer`) instead of depending on when uvx's cache turns
over.

## Step two: configuration

Get the absolute path — `which semlayer`, usually `~/.local/bin/semlayer` —
and use it. A client launched from a dock or a desktop icon does not inherit
the user's shell PATH, so a bare `semlayer` that works in a terminal can
still fail inside the client.

```json
{
  "mcpServers": {
    "semlayer": {
      "command": "/absolute/path/to/semlayer",
      "args": ["mcp"]
    }
  }
}
```

Then **start a new session of the client**. Every MCP client reads its server
list once, at startup — a window or session that was already open when the
config was written has never seen the entry, and will report no semlayer
tools (in Claude Code, `/mcp` simply will not list it). Do not debug the
config over this; open a new session first.

**The `[warehouses]` extra is not decoration.** The Snowflake, BigQuery and
Postgres drivers are optional dependencies. Without them the server can
*find* a warehouse and not open it, which fails on the first real request
rather than at startup — so an install missing that extra looks like it
worked. `status` reports which drivers are importable; if one is missing,
re-run the install command above rather than guessing.

**The `--python 3.13` pin is not decoration either.** On a machine with no
Python, `uv` otherwise downloads the newest CPython, and `duckdb` publishes
wheels only up to cp314 — so the install falls back to building from source,
wants CMake, and fails after about two and a half minutes.

## Optional environment

| Variable | Effect if absent |
|---|---|
| `ANTHROPIC_API_KEY` | Inference still runs on statistics alone. Descriptions and LLM-validated joins are skipped; the layer is thinner but valid. |

No key is required to start the server or to build a layer. Do not block
setup on it, and do not invent one.

## Verifying it worked

Ask the server for `status`. That is the tool to call first in any session:
it reports which warehouses are configured on the machine, whether a layer
has been built, and what to do next. A fresh install with no layer is a
normal, expected state — `status` will say so and name the next step.

If `status` answers, the installation is correct.

## What not to do

- Don't pass a layer file path unless the user has one. The server starts
  with nothing and guides the user through building it.
- Don't run `infer` unprompted. It reads the user's warehouse and, with a
  key set, spends money on LLM calls.

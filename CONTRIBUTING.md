# Contributing

Thanks for your interest! During the beta we accept issues and small PRs;
larger contributions are best discussed in an issue first. Contributions
require agreeing to the project CLA (a bot will prompt on your first PR).

## Checking that it actually works against a warehouse

`tests/test_journey_live.py` walks the whole cycle end to end -- probe, infer,
validate, review and record a verdict, lint, drift, then serve the result over
MCP and run a query -- and names the step that broke. It is the answer to "do
the MCP server and the VS Code extension still work", asked months later.

It skips unless you point it at something:

```bash
# cheap smoke test first: a local file, no credentials, ~25s
SEMLAYER_JOURNEY=duckdb:fixtures/build/messy_mart.duckdb \
  .venv/bin/pytest tests/test_journey_live.py -v

# then the real thing
SEMLAYER_JOURNEY=snowflake:analytics_prod \
  .venv/bin/pytest tests/test_journey_live.py -v
```

Inference runs deterministically by default; `SEMLAYER_JOURNEY_LLM=1` spends
real model budget and exercises Describe too. Everything else is identical.

Two of its tests are the product's central claim: a join that multiplies a
measure must be caught by `lint` and REFUSED by `run_sql`, because that query
executes cleanly on any warehouse and returns a number that is wrong.

Unlike the connector tiers this one is NOT ignored in CI -- it is gated by the
environment variable instead, so a CI run lists it as skipped and the tier
stays visible rather than silently absent.

**The extension.** There is no GUI in any of this. The extension holds no
engine and speaks no MCP: it runs `semlayer <verb> --json` and parses the
result, so the journey suite asserts exactly the contract it depends on, with
the argv it builds. Its views are proved without an editor by
`extension/test/features.test.mjs` (41 features, each carrying its evidence;
`cd extension && npm run qa` prints the manifest). What is still uncovered is
VS Code actually loading the extension, which would need
`@vscode/test-electron`.

`tests/test_mcp_contract.py` needs no warehouse and runs everywhere: it spawns
the server over stdio and holds it to what a client sees -- the tool list, the
handshake version, the instructions, and a `next` sentence when no layer is
loaded.

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev,warehouses]"
python fixtures/build.py        # ~20s: all 9 evaluation warehouses
pytest tests/ -q                # full suite, $0 in LLM spend (cassette replay)
```

## Quality gates (CI enforces all of these)

```bash
ruff check src/                 # lint + complexity<=10 + docstrings: zero findings
ruff format --check src/
mypy                            # zero errors
pytest tests/ -q                # all tests AND eval floors green
```

## Optional: live warehouse tests

CI runs the BigQuery live tier nightly. The Snowflake live tests are not run
in CI (no project-maintained Snowflake account) and skip automatically without
credentials. To run them against your own account:

```bash
# .env: SNOWFLAKE_ACCOUNT, SNOWFLAKE_READER_USER/PASSWORD, SNOWFLAKE_ADMIN_USER/PASSWORD,
#       SNOWFLAKE_WAREHOUSE, SNOWFLAKE_DATABASE
python fixtures/mirror_snowflake.py fan_trap   # one-time: mirror the fixture
pytest tests/test_snowflake_live.py -q
```

## The rules that are different here

1. **Eval floors are contracts.** Accuracy targets live in test files with the
   measured baseline documented. If your change lowers a floor, that is a
   regression to fix, not a number to edit. Raising a floor after a genuine
   improvement is welcome — as its own reviewed change.
2. **Prompt strings are frozen bytes.** Cassette keys hash the exact prompt.
   To change a prompt: bump its `PROMPT_VERSION`, re-record cassettes
   (requires an API key), and include both in the PR. Never edit prompt text
   incidentally.
3. **To check whether a cassette is still needed, use an EMPTY key, not an
   unset one.** `env -u ANTHROPIC_API_KEY pytest` does not give a replay-only
   run: several tests call `load_dotenv()` themselves and restore the key from
   `.env`, so the run RECORDS whatever is missing and then passes. A recording
   run always passes, so it cannot answer the question — and it looks exactly
   like proof that the cassettes were unnecessary.

   ```bash
   ANTHROPIC_API_KEY= pytest -q -rs        # genuinely replay-only
   ```

   An empty value works because python-dotenv does not override a key already
   present in the environment, and `allow_live` resolves to `False`. A correct
   replay-only run on a healthy tree skips exactly one test
   (`test_drift.py`, a logic skip). Any further skip or `CassetteMiss` names a
   recording the tree needs. This was got wrong twice: a batch was declared
   orphaned and deleted on the strength of a run that had quietly re-recorded
   it.

4. **Golds change only by adjudication.** Fixture gold files are ground truth;
   they change only when the fixture *generator source* proves them wrong,
   with the adjudication documented in the commit message.
5. **Comments state constraints, not narration.** Say why the code must be
   this way; never restate what the next line does.
5. **Zero behavior change in refactors** — the suite must pass identically.

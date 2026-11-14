# semlayer in CI

Two things are worth checking automatically, and the engine already exits
nonzero for both: SQL that disagrees with the layer, and a warehouse that has
moved away from it.

## Lint a pull request

```yaml
name: sql
on: pull_request

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - uses: semlayer-dev/semlayer@v0.7.0-beta.6
        with:
          mode: lint
          layer: layer.yaml
          files: "sql/**/*.sql"      # default: **/*.sql
```

Findings appear **on the diff**, at the identifier they are about, with the
fix underneath. That is the only thing this action does that four lines of
`run:` could not: the position comes from the engine's parser, so the marker
lands on `tot_amt` rather than on the statement.

The two findings worth having a gate for are the ones that execute cleanly
and return a wrong number — a join that fans out a sum, and a required filter
nobody wrote down. Neither fails a test suite, because the SQL is valid.

| input | |
|---|---|
| `mode` | `lint` or `drift` |
| `layer` | path to the layer YAML |
| `files` | glob, default `**/*.sql` |
| `dialect` | default `duckdb` — set it to the warehouse you write for |
| `fail-on` | `error` (default), `warning`, or `never` to annotate without failing |
| `version` | the semlayer version to install. **Pin it.** |

`fail-on: never` is how to introduce this to a repository that has years of
SQL in it: every finding is annotated, nothing goes red, and you tighten the
gate when the count reaches zero.

Lint opens no warehouse — it reads the layer and parses SQL — so the action
installs semlayer without the warehouse drivers for this mode, and the job
takes seconds.

## Fail when the warehouse drifts

```yaml
name: drift
on:
  schedule: [{ cron: "0 6 * * *" }]

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - uses: semlayer-dev/semlayer@v0.7.0-beta.6
        with:
          mode: drift
          layer: layer.yaml
          source: snowflake:prod
        env:
          SNOWFLAKE_READER_USER: ${{ secrets.SNOWFLAKE_READER_USER }}
          SNOWFLAKE_READER_PRIVATE_KEY_PATH: ${{ secrets.SNOWFLAKE_KEY_PATH }}
```

Exits 1 when the warehouse no longer matches the layer, with the changeset in
the job summary. `semlayer init <warehouse>` prints the minimal read-only
grants the connection needs.

## Open a pull request instead of failing

Drift that fails a nightly job tells you something changed. A pull request
tells you what to do about it, and lets you merge it.

`examples/maintain/semlayer-maintain.yml` is a workflow to copy: it runs
`maintain --apply`, pushes the updated layer to one standing branch, and
opens or updates a pull request with the maintainer's report as the body.
That one is not an action because it needs repository write, a standing
branch and a PR body — see [docs/maintain.md](maintain.md).

"""The whole day-1 and day-2 cycle against a real warehouse, end to end.

Not a connector test -- `test_snowflake_live.py` and `test_bigquery_live.py`
already prove a connector can read under minimal grants. This proves the
JOURNEY: probe, infer, validate, review, lint, drift, and then serving the
result over MCP and getting a number back. It is the answer to "do the MCP
server and the VS Code extension actually work against a warehouse", asked
months after anyone last touched them.

Run it when you want to know, not on every PR:

    SEMLAYER_JOURNEY=snowflake:analytics_prod \\
      .venv/bin/pytest tests/test_journey_live.py -v

    SEMLAYER_JOURNEY=duckdb:fixtures/build/messy_mart.duckdb \\
      .venv/bin/pytest tests/test_journey_live.py -v

Any connection string the CLI accepts works, including a local DuckDB file --
which is the cheap smoke test before spending a warehouse's credits.

By default inference runs deterministically. Set SEMLAYER_JOURNEY_LLM=1 to
spend real model budget and exercise Describe as well; everything else in the
journey is identical either way.

THE EXTENSION. There is no GUI here. The extension holds no engine and speaks
no MCP -- it runs `semlayer <verb> --json` and parses the result -- so the
contract it depends on is exactly what these tests assert, invoked with the
same argv it builds. Its views are proved separately and without an editor by
`extension/test/features.test.mjs`. What is NOT covered is VS Code actually
loading the extension; that would need @vscode/test-electron, and it is worth
adding the day this suite stops being enough.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

OSS = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv
    load_dotenv(OSS.parent / ".env")
except ImportError:
    pass

SOURCE = os.environ.get("SEMLAYER_JOURNEY", "")
USE_LLM = os.environ.get("SEMLAYER_JOURNEY_LLM") == "1"

pytestmark = pytest.mark.skipif(
    not SOURCE,
    reason="set SEMLAYER_JOURNEY to a connection string to run the journey",
)


def cli(*args: str, stdin: str | None = None, expect: tuple[int, ...] = (0,)) -> str:
    """Run the CLI the way the extension does, and keep stdout either way.

    `lint` exits 2 when it finds something and `review` can exit non-zero with
    perfectly good JSON on stdout, so a non-zero code is not on its own a
    failure -- which is why the extension reads stdout before it reads the code.
    """
    proc = subprocess.run(
        [sys.executable, "-m", "semlayer.cli", *args],
        input=stdin, capture_output=True, text=True, cwd=OSS, timeout=1800,
    )
    if proc.returncode not in expect:
        raise AssertionError(
            f"semlayer {' '.join(args)} exited {proc.returncode}\n"
            f"stdout: {proc.stdout[:2000]}\nstderr: {proc.stderr[:2000]}")
    return proc.stdout


@pytest.fixture(scope="module")
def layer(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """One inferred layer, shared by every step after it."""
    out = tmp_path_factory.mktemp("journey") / "journey.yaml"
    args = ["infer", SOURCE, "-o", str(out)]
    if not USE_LLM:
        args.append("--no-llm")
    cli(*args)
    assert out.exists(), "infer reported success but wrote no document"
    return out


MEASURE_TYPES = ("monetary_value", "quantity", "rate", "percentage", "measure")


def _fanout_pair(sl: dict) -> tuple[str, str, str, str, str] | None:
    """A join that multiplies a real measure: (parent, child, measure, pk, fk).

    Scans EVERY many-to-one relationship rather than taking the first. The
    first version stopped at relationship zero and skipped whenever that one
    pointed at a dimension -- which is most of them, since dimensions are what
    facts point at, so the two tests that assert the product's central claim
    quietly never ran.
    """
    for rel in sl.get("relationships", []):
        if rel.get("cardinality") != "many_to_one":
            continue
        parent, child = rel["to"]["table"], rel["from"]["table"]
        table = next((t for t in sl["tables"] if t["name"] == parent), None)
        if not table:
            continue
        measure = next((c["name"] for c in table["columns"]
                        if c.get("semantic_type") in MEASURE_TYPES), None)
        if measure:
            return parent, child, measure, rel["to"]["columns"][0], rel["from"]["columns"][0]
    return None


# --- day 1 -----------------------------------------------------------------

def test_probe_reports_what_the_scope_screen_reads() -> None:
    """The fields the extension's Scope screen renders before spending money."""
    p = json.loads(cli("probe", SOURCE, "--json"))
    for key in ("tables", "columns", "schemas", "declared_pk_ratio",
                "declared_fk_ratio", "has_manifest", "grade"):
        assert key in p, f"probe --json no longer reports {key}"
    assert p["tables"] > 0, "probe found no tables"


def test_infer_writes_a_document_that_validates(layer: Path) -> None:
    out = cli("validate", str(layer))
    assert "OK" in out, out


def test_the_layer_has_tables_and_a_warehouse(layer: Path) -> None:
    doc = yaml.safe_load(layer.read_text())
    sl = doc["semantic_layer"]
    assert sl["tables"], "the document has no tables"
    assert sl.get("warehouse"), "the document does not record which warehouse it came from"


def test_review_queue_has_the_shape_the_screen_renders(layer: Path) -> None:
    q = json.loads(cli("review", str(layer), "--list", "--json"))
    assert "questions" in q and "undecided_items" in q
    for item in q["questions"]:
        for key in ("key", "kind", "claim", "engine_saw", "count",
                    "objects", "on_accept", "on_reject"):
            assert key in item, f"a review question no longer carries {key}"


def test_a_verdict_records_who_decided_it(layer: Path) -> None:
    """The write path behind the Accept button."""
    q = json.loads(cli("review", str(layer), "--list", "--json"))
    if not q["questions"]:
        pytest.skip("nothing was left undecided on this warehouse")
    key = q["questions"][0]["key"]
    cli("review", str(layer), "--answer", f"{key}=accept", "--by", "journey test")

    decisions = json.loads(cli("review", str(layer), "--decisions", "--json"))
    assert decisions, "the verdict was not recorded"
    assert any(d.get("by") == "journey test" for d in decisions)
    assert all(d.get("signal") == "human" for d in decisions if d.get("by") == "journey test")


def test_lint_findings_carry_a_fix_and_no_position(layer: Path) -> None:
    """The contract the editor's squiggles are reconstructed from.

    If `line` ever appears, `extension/src/positions.ts` becomes dead code and
    should go -- so this asserts its ABSENCE deliberately, not by omission.
    """
    doc = yaml.safe_load(layer.read_text())
    table = doc["semantic_layer"]["tables"][0]["name"]
    results = json.loads(cli("lint", str(layer), "-", "--json",
                             stdin=f"select * from {table}", expect=(0, 1, 2)))
    assert isinstance(results, list) and results
    assert "sql" in results[0], "lint no longer echoes the SQL it linted"
    for finding in results[0]["findings"]:
        for key in ("rule", "severity", "message", "table", "column", "fix"):
            assert key in finding
        assert "line" not in finding, "the engine now reports positions; simplify the extension"


def test_lint_catches_a_fan_out_if_the_warehouse_has_one(layer: Path) -> None:
    """The finding that executes cleanly and returns a wrong number.

    Skipped rather than failed when no join multiplies a measure: that is a
    fact about the data, not a defect.
    """
    sl = yaml.safe_load(layer.read_text())["semantic_layer"]
    pair = _fanout_pair(sl)
    if not pair:
        pytest.skip("no join here multiplies a measure")
    parent, child, measure, pk, fk = pair

    sql = (f"select sum(p.{measure}) from {parent} p "
           f"join {child} c on c.{fk} = p.{pk}")
    results = json.loads(cli("lint", str(layer), "-", "--json", stdin=sql, expect=(0, 1, 2)))
    rules = {f["rule"] for f in results[0]["findings"]}
    assert "fanout_aggregate" in rules, f"the fan-out was not caught; got {rules}"


# --- day 2 -----------------------------------------------------------------

def test_drift_answers_either_as_json_or_as_calm(layer: Path) -> None:
    """A freshly built layer should report no drift, and say so in prose.

    This is the shape that broke the extension's first drift reader: with
    nothing to report the CLI prints a sentence, not JSON.
    """
    out = cli("drift", str(layer), SOURCE, "--json", expect=(0, 1)).strip()
    if out.startswith("{"):
        d = json.loads(out)
        for key in ("events", "orphaned", "needs_inference", "affected"):
            assert key in d
    else:
        assert "drift" in out.lower(), out


def test_a_dropped_table_is_seen_as_drift(layer: Path, tmp_path: Path) -> None:
    """Remove a table from the document and the warehouse should look changed."""
    doc = yaml.safe_load(layer.read_text())
    if len(doc["semantic_layer"]["tables"]) < 2:
        pytest.skip("need at least two tables to drop one")
    dropped = doc["semantic_layer"]["tables"].pop()["name"]

    edited = tmp_path / "drifted.yaml"
    edited.write_text(yaml.safe_dump(doc, sort_keys=False))

    out = cli("drift", str(edited), SOURCE, "--json", expect=(0, 1)).strip()
    assert out.startswith("{"), f"dropping {dropped} produced no drift report: {out[:200]}"
    d = json.loads(out)
    assert any(e["table"] == dropped for e in d["events"]), \
        f"{dropped} is in the warehouse and not in the document, and drift did not say so"


# --- serving it ------------------------------------------------------------

class _Mcp:
    """The smallest client that can ask the server a question."""

    def __init__(self, proc: subprocess.Popen[str]) -> None:
        self.proc, self._id = proc, 0

    def call(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(
            {"jsonrpc": "2.0", "id": self._id, "method": method,
             "params": params or {}}) + "\n")
        self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise AssertionError(f"{method}: the server closed stdout")
            if line.strip().startswith("{"):
                reply = json.loads(line)
                assert "error" not in reply, f"{method}: {reply['error']}"
                return reply["result"]

    def notify(self, method: str) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(
            {"jsonrpc": "2.0", "method": method, "params": {}}) + "\n")
        self.proc.stdin.flush()

    def tool(self, name: str, **arguments: object) -> str:
        result = self.call("tools/call", {"name": name, "arguments": arguments})
        return "".join(c.get("text", "") for c in result.get("content", []))


@pytest.fixture
def served(layer: Path):
    """The layer, served over stdio, with the warehouse reachable."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "semlayer.cli", "mcp", str(layer),
         "--connection", SOURCE],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1, cwd=OSS,
    )
    client = _Mcp(proc)
    client.call("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                               "clientInfo": {"name": "journey", "version": "0"}})
    client.notify("notifications/initialized")
    try:
        yield client
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_served_layer_knows_its_tables(served: _Mcp, layer: Path) -> None:
    doc = yaml.safe_load(layer.read_text())
    first = doc["semantic_layer"]["tables"][0]["name"]
    assert first in served.tool("get_tables")


def test_context_for_question_answers_with_the_layer(served: _Mcp) -> None:
    """The call the server's own instructions tell a client to start with."""
    text = served.tool("context_for_question", question="how much revenue last quarter")
    assert "TABLE" in text or "tables" in text, text[:400]


def test_run_sql_lints_before_it_executes(served: _Mcp, layer: Path) -> None:
    """A fan-out must be REFUSED, not run.

    The product claim in one assertion: this query executes cleanly on any
    warehouse and returns a number that is wrong.
    """
    sl = yaml.safe_load(layer.read_text())["semantic_layer"]
    pair = _fanout_pair(sl)
    if not pair:
        pytest.skip("no join here multiplies a measure")
    parent, child, measure, pk, fk = pair

    out = served.tool("run_sql", sql=(
        f"select sum(p.{measure}) from {parent} p join {child} c on c.{fk} = p.{pk}"))
    flat = out.lower().replace(" ", "").replace("\\", "")
    assert "fanout" in flat or '"ran":false' in flat, \
        f"the fan-out was executed instead of refused: {out[:400]}"


def test_a_plain_select_runs_and_returns_rows(served: _Mcp, layer: Path) -> None:
    """The end of the journey: a real query against the real warehouse."""
    doc = yaml.safe_load(layer.read_text())
    table = doc["semantic_layer"]["tables"][0]
    source = table.get("source") or table["name"]
    out = served.tool("run_sql", sql=f"select count(*) as n from {source}")
    assert '"ran": true' in out.replace(" ", "").replace('"ran":true', '"ran": true') \
        or '"ran":true' in out.replace(" ", ""), out[:400]

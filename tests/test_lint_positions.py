"""Where a finding is, not just what it is.

Every consumer of `lint` needs this and none of them had it. The VS Code
extension reconstructed ranges by searching the text for the identifier --
its README had to say the underlines were "close, not exact" -- and a CI
annotation could do no better than put a marker on line 1.

sqlglot was recording exact positions the whole time, on the `Identifier`
nodes inside each Column and Table. Nothing here searches text.

The assertions resolve each position TWICE, once by line and column and once
by byte offset, and require the two to agree on the same identifier. An
off-by-one in either direction fails rather than passing quietly, which is
the failure this file exists to prevent.
"""

from __future__ import annotations

import pytest
import yaml

from semlayer.lint import lint_sql, split_statements, to_file_positions

# Shaped the way a real document is -- `required_filters` live under the
# table's `knowledge`, and fan-out risk is a property of a RELATIONSHIP at
# the document level, not of a table. Written by hand rather than fixtured
# so the positions under test are not at the mercy of an inference run.
LAYER = yaml.safe_load("""
semantic_layer:
  name: t
  tables:
    - name: ord_hdr
      columns:
        - {name: ord_id, semantic_type: identifier}
        - {name: tot_amt, semantic_type: monetary_value, entity_role: measure}
        - {name: sts_cd, semantic_type: status_code}
      knowledge:
        required_filters:
          - {expr: "sts_cd <> 'X'", scope: measures}
    - name: ord_ln
      columns:
        - {name: ord_ln_id, semantic_type: identifier}
        - {name: ord_id, semantic_type: identifier}
    - name: ord_hdr_legacy
      lifecycle: deprecated
      deprecation: {replacement: ord_hdr}
      columns:
        - {name: ord_id, semantic_type: identifier}
  relationships:
    - from: {table: ord_ln, column: ord_id}
      to: {table: ord_hdr, column: ord_id}
      type: many_to_one
      fanout_risk: true
""")


def _resolve(sql: str, finding: dict) -> tuple[str, str]:
    """The identifier a finding points at, by line/col and by offset."""
    by_line = sql.splitlines()[finding["line"] - 1][
        finding["col"] - 1: finding["col"] - 1 + finding["end"] - finding["start"] + 1]
    by_offset = sql[finding["start"]: finding["end"] + 1]
    return by_line, by_offset


def _one(sql: str, rule: str) -> dict:
    result = lint_sql(LAYER, sql)
    hits = [f for f in result["findings"] if f["rule"] == rule]
    assert hits, f"{rule} did not fire: {[f['rule'] for f in result['findings']]}"
    return hits[0]


@pytest.mark.parametrize("rule,sql,expected", [
    # The aggregate that silently multiplies: point at the COLUMN whose
    # number is wrong, which is where a reader looks.
    ("fanout_aggregate",
     "SELECT SUM(h.tot_amt)\nFROM ord_hdr h\nJOIN ord_ln l ON l.ord_id = h.ord_id",
     "tot_amt"),
    # The rule nobody declared: point at the table it applies to.
    ("missing_required_filter",
     "SELECT SUM(h.tot_amt)\nFROM ord_hdr h",
     "ord_hdr"),
    ("deprecated_table",
     "SELECT ord_id\nFROM ord_hdr_legacy",
     "ord_hdr_legacy"),
    ("unknown_column",
     "SELECT h.nope\nFROM ord_hdr h",
     "nope"),
    ("unknown_table",
     "SELECT 1\nFROM no_such_table",
     "no_such_table"),
])
def test_a_finding_points_at_the_thing_it_is_about(rule, sql, expected):
    f = _one(sql, rule)
    by_line, by_offset = _resolve(sql, f)
    assert by_line == expected, f"line/col landed on {by_line!r}"
    assert by_offset == expected, f"the offsets landed on {by_offset!r}"


def test_the_column_is_where_the_name_STARTS():
    """sqlglot records the column of a token's LAST character.

    `tot_amt` in `SUM(h.tot_amt)` ends at column 20 and starts at 14. Every
    consumer wants the start: an editor opens a squiggle there, GitHub puts
    its marker there.
    """
    sql = ("SELECT SUM(h.tot_amt) FROM ord_hdr h "
           "JOIN ord_ln l ON l.ord_id = h.ord_id")
    f = _one(sql, "fanout_aggregate")
    #          1234567890123
    # SELECT SUM(h.tot_amt)  -- `tot_amt` starts at 14 and ends at 20
    assert f["col"] == 14, "expected the start of tot_amt, not its end"
    assert sql[f["start"]:f["end"] + 1] == "tot_amt"


def test_a_parse_failure_reports_no_position_rather_than_a_wrong_one():
    result = lint_sql(LAYER, "SELECT FROM WHERE ((")
    assert result["findings"]
    for f in result["findings"]:
        assert f["line"] is None and f["col"] is None


# --- statements within a file ----------------------------------------------

FILE = """-- a comment that pushes everything down
-- and a second line of it

SELECT SUM(h.tot_amt) AS revenue
FROM ord_hdr h
JOIN ord_ln l ON l.ord_id = h.ord_id;

SELECT ord_id FROM ord_hdr_legacy;
"""


def test_statements_carry_where_they_start():
    """Splitting on `;` and stripping threw this away, so every finding in
    every statement but the first was reported against the wrong line."""
    stmts = split_statements(FILE)
    assert len(stmts) == 2
    assert stmts[0][1] == 0, "the first statement begins on the file's first line"
    assert stmts[1][1] == 7, "the second begins on line 8, 0-based 7"
    assert FILE[stmts[1][2]:].startswith("SELECT ord_id")


def test_findings_are_reported_against_the_FILE():
    hits = []
    for sql, line_offset, char_offset in split_statements(FILE):
        r = to_file_positions(lint_sql(LAYER, sql), line_offset, char_offset)
        hits.extend(r["findings"])

    for f in hits:
        by_line, by_offset = _resolve(FILE, f)
        assert by_line == by_offset, (
            f"{f['rule']} disagrees with itself: {by_line!r} vs {by_offset!r}")

    deprecated = next(f for f in hits if f["rule"] == "deprecated_table")
    assert deprecated["line"] == 8, "the second statement is on line 8 of the file"


def test_an_empty_trailing_statement_is_not_a_statement():
    assert split_statements("SELECT 1;\n\n") == [("SELECT 1", 0, 0)]
    assert split_statements("   \n  \n") == []

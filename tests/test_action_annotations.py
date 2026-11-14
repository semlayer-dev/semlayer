"""Turning findings into GitHub annotations.

The point of the action is that a finding appears ON the line in a pull
request diff. Everything here is about the two ways that silently fails:
a position that is wrong, and an escape that is missing.

Escaping is not cosmetic. A workflow command ends at a newline and its
properties are comma-separated and colon-terminated -- and our messages
contain commas, colons and newlines. An unescaped one does not error; it
truncates the annotation or shifts the message into a property, which looks
like nothing happening.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "action"))

from annotate import annotation, escape_data, escape_property, main, run  # noqa: E402


def _finding(**over) -> dict:
    base = {
        "rule": "fanout_aggregate",
        "severity": "error",
        "message": "SUM(ord_hdr.tot_amt) multiplies ord_hdr's values",
        "table": "ord_hdr",
        "column": "tot_amt",
        "fix": "aggregate ord_ln in a subquery first",
        "line": 4,
        "col": 14,
        "start": 36,
        "end": 42,
    }
    base.update(over)
    return base


def test_the_annotation_names_the_file_line_and_column():
    out = annotation("q.sql", _finding())
    assert out.startswith("::error ")
    assert "file=q.sql" in out
    assert "line=4" in out
    assert "col=14" in out
    # `end` is the last character, so the span covers the whole identifier.
    assert "endColumn=20" in out


def test_the_fix_travels_with_the_message():
    out = annotation("q.sql", _finding())
    assert "fix%3A" in out or "fix:" in out
    assert "%0A" in out, "the newline before the fix must be escaped, not raw"


def test_a_newline_never_ends_the_command_early():
    """A raw newline ends the command; the rest becomes ordinary log output,
    so the annotation silently keeps only its first line."""
    out = annotation("q.sql", _finding(message="one\ntwo"))
    assert "\n" not in out
    assert "one%0Atwo" in out


def test_commas_and_colons_in_a_property_are_escaped():
    """Properties are comma-separated and colon-terminated. A rule name or a
    title containing either would be read as the next property."""
    out = annotation("a,b:c.sql", _finding())
    assert "file=a%2Cb%3Ac.sql" in out
    assert "title=semlayer%3A fanout_aggregate" in out


def test_percent_is_escaped_first():
    """Escaping % after %0A would turn the escape itself into %250A."""
    assert escape_data("100%\n") == "100%25%0A"
    assert escape_property("a:b") == "a%3Ab"


def test_a_finding_with_no_position_still_annotates_the_file():
    """A parse failure is about the statement, not a token in it. The
    annotation must still appear -- on the file -- rather than vanish."""
    out = annotation("q.sql", _finding(line=None, col=None, start=None, end=None,
                                       rule="parse_error"))
    assert "file=q.sql" in out
    assert "line=" not in out


@pytest.mark.parametrize("severity,level", [
    ("error", "error"), ("warning", "warning"), ("info", "notice"),
    ("advisory", "notice"), ("something-new", "warning"),
])
def test_severity_maps_to_the_three_levels_github_has(severity, level):
    assert annotation("q.sql", _finding(severity=severity)).startswith(f"::{level} ")


# --- what fails the job -----------------------------------------------------

def _results(*severities) -> list[dict]:
    return [{"file": "q.sql",
             "findings": [_finding(severity=s) for s in severities]}]


@pytest.mark.parametrize("severities,fail_on,code", [
    (("error",), "error", 1),
    (("warning",), "error", 0),
    (("warning",), "warning", 1),
    (("info",), "warning", 0),
    (("error",), "never", 0),
    ((), "error", 0),
])
def test_the_threshold_decides_the_exit_code(severities, fail_on, code):
    _, rc, _ = run(_results(*severities) if severities else [], fail_on)
    assert rc == code


def test_counts_are_reported_per_level():
    _, _, counts = run(_results("error", "warning", "warning", "info"), "error")
    assert counts == {"error": 1, "warning": 2, "notice": 1}


def test_empty_input_is_not_a_failure(monkeypatch, capsys):
    """No SQL changed in this pull request is the commonest run of all."""
    monkeypatch.setattr("sys.stdin", __import__("io").StringIO(""))
    assert main(["--fail-on", "error"]) == 0
    assert "0 error(s)" in capsys.readouterr().out

# SPDX-License-Identifier: FSL-1.1-ALv2
"""Turn `semlayer lint --json` into GitHub Actions annotations.

An annotation is what puts a finding ON the line in a pull request diff,
which is the only reason to wrap the linter in an action at all: anyone can
run the CLI in four lines of YAML, but nobody can make the result appear
next to the SQL that caused it.

    semlayer lint layer.yaml q.sql --json | python action/annotate.py --fail-on error

Reads the JSON on stdin, writes workflow commands on stdout, and exits
nonzero when something at or above the threshold was found.
"""

from __future__ import annotations

import argparse
import json
import sys

#: error | warning | notice are the three GitHub understands. `info` is ours.
_LEVEL = {"error": "error", "warning": "warning", "info": "notice",
          "advisory": "notice"}

_RANK = {"notice": 0, "warning": 1, "error": 2}


def escape_data(value: str) -> str:
    """Escape a workflow command's MESSAGE.

    A raw newline would end the command and leave the rest of the message
    printed as ordinary log output -- which is how a multi-line fix hint
    silently truncates an annotation to its first line.
    """
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def escape_property(value: str) -> str:
    """Escape a workflow command's PROPERTY value.

    Properties are comma-separated and colon-terminated, so a `,` or `:` in
    a title -- and our rule names and messages contain both -- would be read
    as the start of the next property or of the message.
    """
    return (escape_data(value)
            .replace(":", "%3A")
            .replace(",", "%2C"))


def annotation(file: str, finding: dict) -> str:
    """One `::level file=...,line=...::message` command."""
    level = _LEVEL.get(finding.get("severity", ""), "warning")
    props = [f"file={escape_property(file)}"]

    line = finding.get("line")
    if isinstance(line, int):
        props.append(f"line={line}")
        col = finding.get("col")
        if isinstance(col, int):
            props.append(f"col={col}")
            # endColumn is exclusive of nothing in particular: GitHub treats
            # it as the last column, and `end` is the identifier's last
            # character, so the arithmetic is the same shape as the editor's.
            start, end = finding.get("start"), finding.get("end")
            if isinstance(start, int) and isinstance(end, int):
                props.append(f"endColumn={col + (end - start)}")

    rule = finding.get("rule", "semlayer")
    props.append(f"title={escape_property(f'semlayer: {rule}')}")

    message = finding.get("message", "")
    if finding.get("fix"):
        message = f"{message}\n\nfix: {finding['fix']}"
    return f"::{level} {','.join(props)}::{escape_data(message)}"


def run(results: list[dict], fail_on: str) -> tuple[list[str], int, dict[str, int]]:
    """Annotations, the exit code, and a count per level."""
    lines: list[str] = []
    counts = {"error": 0, "warning": 0, "notice": 0}
    for statement in results:
        file = statement.get("file") or ""
        for finding in statement.get("findings", []):
            lines.append(annotation(file, finding))
            counts[_LEVEL.get(finding.get("severity", ""), "warning")] += 1

    if fail_on == "never":
        return lines, 0, counts
    threshold = _RANK.get(fail_on, 2)
    worst = max((_RANK[level] for level, n in counts.items() if n), default=-1)
    return lines, (1 if worst >= threshold else 0), counts


def main(argv: list[str] | None = None) -> int:
    """Read lint JSON on stdin, print annotations, return the exit code."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--fail-on", default="error",
                    choices=["error", "warning", "never"],
                    help="the lowest severity that fails the job")
    ap.add_argument("--summary", default="",
                    help="also append a one-line summary to this file "
                         "($GITHUB_STEP_SUMMARY)")
    args = ap.parse_args(argv)

    raw = sys.stdin.read().strip()
    results = json.loads(raw) if raw else []

    lines, code, counts = run(results, args.fail_on)
    for line in lines:
        print(line)  # noqa: T201 -- stdout IS the annotation channel

    total = sum(counts.values())
    summary = (f"semlayer: {counts['error']} error(s), {counts['warning']} warning(s), "
               f"{counts['notice']} notice(s) across {len(results)} statement(s)")
    print(summary)  # noqa: T201
    if args.summary and total:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(f"### {summary}\n")
    return code


if __name__ == "__main__":
    sys.exit(main())

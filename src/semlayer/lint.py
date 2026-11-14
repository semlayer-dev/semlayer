# SPDX-License-Identifier: FSL-1.1-ALv2
"""Semantic SQL linter: check SQL an agent (or a human) wrote against the layer.

Every vendor performs these checks inside a closed compiler; here they run
over arbitrary SQL against the open document, before execution. Findings
are deterministic, explainable, and cheap (no LLM):

  parse_error                 the SQL does not parse in the given dialect
  unknown_table               a referenced table is not in the layer
  unknown_column              a referenced column does not exist on its table
  correlated_reference        an unqualified column that is NOT on the tables
                              of its own query block silently resolves to an
                              outer block (the classic vacuous `IN (SELECT ...)`)
  deprecated_table            a deprecated/orphaned table is read (replacement named)
  missing_required_filter     a table's required filter is absent for a query
                              that its scope covers (all / amount aggregations)
  fanout_aggregate            SUM/AVG over a parent table's column in a block
                              that also joins a many-rows child of that parent
  scd2_without_validity       an SCD2 table is used without its validity window
                              or current-row flag

Severity: `error` findings mean the answer is wrong or unsafe; `warning`
findings mean it is probably wrong; `info` is advisory. Consumers SHOULD
repair on errors and warnings before executing.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import cast

import sqlglot
from sqlglot import exp
from sqlglot.optimizer.scope import Scope, traverse_scope

_ADDITIVE = (exp.Sum, exp.Avg)
_MEASURE_TYPES = {"monetary_value", "quantity", "rate", "percentage", "measure"}


@dataclass
class Finding:
    """One linter finding; `fix` is the actionable hint a consumer feeds back to the agent."""

    rule: str
    severity: str  # error | warning | info
    message: str
    table: str | None = None
    column: str | None = None
    fix: str | None = None
    #: Where in the SQL, 1-based line and column, with byte offsets into the
    #: statement. None when the finding is about the statement as a whole
    #: (a parse error) rather than about something in it.
    #:
    #: These come from sqlglot, which records them on `Identifier` nodes
    #: during parsing. Nothing here reconstructs a position by searching the
    #: text: an editor doing that is approximating, and the extension's
    #: README had to admit its underlines were "close, not exact".
    line: int | None = None
    col: int | None = None
    start: int | None = None
    end: int | None = None


#: sqlglot records positions on the Identifier, not on the Column or Table
#: that owns it, so anchoring means walking down to the name.
_POSITION_KEYS = ("line", "col", "start", "end")


def _pos(node: exp.Expression | None) -> dict[str, int]:
    """Line, column and offsets for `node`, or {} when it carries none.

    Prefers the node's own position, then its `this` (a Column's or Table's
    Identifier), then the first descendant that has one -- which is what
    makes a compound reference like `h.tot_amt` point at `tot_amt` rather
    than at the alias.
    """
    if node is None:
        return {}
    for candidate in (node, node.args.get("this")):
        if isinstance(candidate, exp.Expression):
            found = {k: candidate.meta[k] for k in _POSITION_KEYS if k in candidate.meta}
            if found:
                return _start_column(found)
    for descendant in node.walk():
        found = {k: descendant.meta[k] for k in _POSITION_KEYS if k in descendant.meta}
        if found:
            return _start_column(found)
    return {}


def _start_column(pos: dict[str, int]) -> dict[str, int]:
    """Report where the name BEGINS, which is not what sqlglot stores.

    sqlglot's `col` is the 1-based column of the token's LAST character --
    `tot_amt` on `SUM(h.tot_amt)` is col 20, where it ends, not 14 where it
    starts. Every consumer of a position wants the start: an editor opens a
    squiggle there and GitHub puts its marker there. The offsets make the
    conversion exact rather than a guess about the name's length.
    """
    out = dict(pos)
    if all(k in pos for k in ("col", "start", "end")):
        out["col"] = pos["col"] - (pos["end"] - pos["start"])
    return out


def _table_node(scope: Scope, name: str) -> exp.Table | None:
    """The Table node a finding about `name` should point at.

    Some rules know only the physical table name -- they reached it through
    an alias map -- so the node has to be found again to anchor the finding.
    """
    lowered = name.lower()
    for table in scope.expression.find_all(exp.Table):
        if table.name.lower() == lowered:
            return table
    return None


class _Layer:
    """Lookup views over the semantic layer, all lower-cased."""

    def __init__(self, doc: dict, dialect: str):
        sl = doc["semantic_layer"]
        self.dialect = dialect
        self.tables: dict[str, dict] = {t["name"].lower(): t for t in sl["tables"]}
        # SQL names a table by its `source` (schema.table) or, in the default
        # schema, by the bare name; both resolve to the document's table key.
        self.by_source: dict[str, str] = {}
        for t in sl["tables"]:
            if t.get("source"):
                self.by_source[t["source"].lower()] = t["name"].lower()
                self.by_source.setdefault(t["source"].rsplit(".", 1)[-1].lower(),
                                          t["name"].lower())
        self.columns: dict[str, dict[str, dict]] = {
            n: {c["name"].lower(): c for c in t["columns"]} for n, t in self.tables.items()
        }
        # child -> parent for every many_to_one relationship that fans out from the parent side
        self.children: dict[str, set[str]] = {}
        for r in sl.get("relationships", []):
            if r.get("fanout_risk"):
                child, parent = r["from"]["table"].lower(), r["to"]["table"].lower()
                self.children.setdefault(parent, set()).add(child)

    def key_for(self, sql_table: str) -> str:
        """The document table a SQL table reference names, else the reference itself."""
        low = sql_table.lower()
        if low in self.tables:
            return low
        return self.by_source.get(low) or self.by_source.get(low.rsplit(".", 1)[-1]) or low

    def is_measure(self, table: str, column: str) -> bool:
        c = self.columns.get(table, {}).get(column)
        if not c:
            return False
        return c.get("entity_role") == "measure" or c.get("semantic_type") in _MEASURE_TYPES


def _filter_expr(f: dict, dialect: str) -> str:
    """A required filter's expression for this dialect (dialect_sql may be a string or a map)."""
    e = f.get("expr")
    if isinstance(e, dict):
        return e.get(dialect) or next(iter(e.values()), "")
    return str(e or "")


def _bare(node: exp.Expression, dialect: str) -> str:
    """Normalised predicate text with table qualifiers stripped, for structural comparison."""
    stripped = node.transform(
        lambda n: exp.column(n.name) if isinstance(n, exp.Column) else n
    )
    return stripped.sql(dialect=dialect).lower()


def _conjuncts(scope: Scope) -> list[exp.Expression]:
    """All top-level AND-ed predicates of a query block: WHERE plus every JOIN ... ON."""
    out: list[exp.Expression] = []
    sel = scope.expression
    where = sel.args.get("where")
    if where is not None:
        out.extend(_split_and(where.this))
    for j in sel.args.get("joins", []) or []:
        on = j.args.get("on")
        if on is not None:
            out.extend(_split_and(on))
    return out


def _split_and(node: exp.Expression) -> list[exp.Expression]:
    """Top-level conjuncts of a predicate (the predicate itself when it is not an AND).

    Parentheses are unwrapped first, at every level: `(a)` is one conjunct and
    `(a AND b)` is two. Without this a parenthesised predicate normalises with
    its brackets attached and can never equal a required filter -- and
    `compile_metric` emits exactly that form, so the linter reported our own
    compiler's output as missing the filter the compiler had just applied.
    """
    while isinstance(node, exp.Paren):
        node = node.this
    if isinstance(node, exp.And):
        return [c for n in node.flatten() for c in _split_and(cast(exp.Expression, n))]
    return [node]


def _physical(scope: Scope, layer: _Layer | None = None) -> dict[str, str]:
    """Alias -> document table for the real tables in this block (CTEs/subqueries excluded).

    A `schema.table` in the SQL resolves through the layer's `source` values,
    so `finance.fct_gl` finds the set's `finance/fct_gl`; an unknown table
    keeps its own spelling for the finding.
    """
    out: dict[str, str] = {}
    for alias, src in scope.sources.items():
        if isinstance(src, exp.Table):
            full = f"{src.db}.{src.name}" if src.db else src.name
            out[alias.lower()] = layer.key_for(full) if layer else src.name.lower()
    return out


def _block_aggregates(scope: Scope) -> list[exp.AggFunc]:
    """Aggregate calls that belong to this block (not to a nested subquery)."""
    return [a for a in scope.expression.find_all(exp.AggFunc)
            if a.find_ancestor(exp.Select) is scope.expression]


def _outer_tables(scope: Scope, layer: _Layer | None = None) -> set[str]:
    tables: set[str] = set()
    p = scope.parent
    while p is not None:
        tables |= set(_physical(p, layer).values())
        p = p.parent
    return tables


class _Linter:
    def __init__(self, layer: _Layer):
        self.L = layer
        self.findings: list[Finding] = []
        self._seen: set[tuple] = set()

    # ---------------------------------------------------------- per block
    def block(self, scope: Scope) -> None:
        phys = _physical(scope, self.L)
        self._tables(scope, phys)
        self._columns(scope, phys)
        self._required_filters(scope, phys)
        self._fanout(scope, phys)
        self._scd2(scope, phys)

    def _tables(self, scope: Scope, phys: dict[str, str]) -> None:
        for name in set(phys.values()):
            at = _table_node(scope, name)
            t = self.L.tables.get(name)
            if t is None:
                self._add(Finding("unknown_table", "error",
                                  f"table {name} is not in the semantic layer", name), at)
            elif t.get("lifecycle") in ("deprecated", "orphaned"):
                rep = t.get("deprecation", {}).get("replacement")
                self._add(Finding(
                    "deprecated_table", "error",
                    f"{name} is {t['lifecycle']}"
                    + (f"; use {rep} instead" if rep else ""),
                    name, fix=f"rewrite the query against {rep}" if rep else None), at)

    def _resolve_column(self, col: exp.Column, scope: Scope, phys: dict[str, str]) -> str | None:
        """Physical table owning this column reference, or None when unresolved."""
        if col.table:
            return phys.get(col.table.lower())
        owners = [t for t in set(phys.values()) if col.name.lower() in self.L.columns.get(t, {})]
        return owners[0] if owners else None

    def _add(self, f: Finding, at: exp.Expression | None = None) -> None:
        """Record a finding, anchored at `at` when the node is known.

        The anchor is applied here rather than at every construction site so
        that adding a rule cannot forget it: a rule that knows which node it
        is complaining about passes it, and one that genuinely does not
        (a parse failure) passes nothing and reports no position.
        """
        for field, value in _pos(at).items():
            setattr(f, field, value)
        key = (f.rule, f.table, f.column)
        if key not in self._seen:
            self._seen.add(key)
            self.findings.append(f)

    def _columns(self, scope: Scope, phys: dict[str, str]) -> None:
        # explicit `expr AS alias` names are legal in GROUP BY / ORDER BY / HAVING
        aliases = {e.alias.lower() for e in scope.expression.expressions
                   if isinstance(e, exp.Alias)}
        for col in scope.columns:
            if col.find_ancestor(exp.Select) is not scope.expression:
                continue  # belongs to a nested subquery block, linted in its own scope
            if col.table:
                self._qualified_column(col, scope, phys)
            elif col.name.lower() not in aliases and not self._resolve_column(col, scope, phys):
                self._unqualified_column(col, scope, phys)

    def _qualified_column(self, col: exp.Column, scope: Scope, phys: dict[str, str]) -> None:
        name, alias = col.name.lower(), col.table.lower()
        src = scope.sources.get(alias) or scope.sources.get(col.table)
        if isinstance(src, Scope):  # CTE / derived table: validate against its outputs
            outs = {a.lower() for a in getattr(src.expression, "named_selects", [])}
            if outs and name not in outs and not src.expression.is_star:
                self._add(Finding("unknown_column", "error",
                                  f"{col.table}.{col.name}: {col.table} does not output {col.name}",
                                  col.table, col.name), col)
            return
        table = phys.get(alias)
        if table is None or table not in self.L.columns:
            return  # outer alias, or unknown table (reported by _tables)
        if name not in self.L.columns[table]:
            cols = ", ".join(list(self.L.columns[table])[:12])
            self._add(Finding("unknown_column", "error", f"{table}.{col.name} does not exist",
                              table, col.name, fix=f"columns of {table}: {cols}"), col)

    def _unqualified_column(self, col: exp.Column, scope: Scope, phys: dict[str, str]) -> None:
        name = col.name.lower()
        here = {t for t in set(phys.values()) if t in self.L.columns}
        if not here:
            return  # block reads only CTEs / unknown tables; cannot validate
        outer = [t for t in _outer_tables(scope, self.L) if name in self.L.columns.get(t, {})]
        if outer:
            self._add(Finding(
                "correlated_reference", "error",
                f"{col.name} is not a column of {', '.join(sorted(here))}; it silently "
                f"resolves to the outer query's {outer[0]}.{col.name}, which makes this "
                f"subquery match every row",
                outer[0], col.name,
                fix=f"qualify the column or join {outer[0]} inside the subquery"), col)
        else:
            self._add(Finding("unknown_column", "error",
                              f"{col.name} is not a column of {', '.join(sorted(here))}",
                              None, col.name), col)

    def _required_filters(self, scope: Scope, phys: dict[str, str]) -> None:
        preds = [_bare(p, self.L.dialect) for p in _conjuncts(scope)]
        aggs = _block_aggregates(scope)
        for table in set(phys.values()):
            t = self.L.tables.get(table)
            if not t:
                continue
            for f in t.get("knowledge", {}).get("required_filters", []):
                expr = _filter_expr(f, self.L.dialect)
                if not expr:
                    continue
                if f.get("scope") == "measures" and not self._sums_measure_of(aggs, table, phys):
                    continue
                try:
                    parsed = cast(exp.Expression, sqlglot.parse_one(expr, read=self.L.dialect))
                    want = _bare(parsed, self.L.dialect)
                except sqlglot.errors.ParseError:
                    want = expr.lower()
                if (any(p == want for p in preds)
                        or self._semijoin_satisfied(expr, scope, phys, preds)):
                    continue
                cols = {c.name.lower() for c in sqlglot.parse_one(expr, read=self.L.dialect)
                        .find_all(exp.Column)}
                touched = any(c in p for p in preds for c in cols)
                sev = "advisory" if f.get("enforcement") == "advisory" else "required"
                self._add(Finding(
                    "missing_required_filter",
                    "warning" if touched or sev == "advisory" else "error",
                    f"{table} requires `{expr}`"
                    + (" for amount aggregations" if f.get("scope") == "measures"
                       else " for all queries")
                    + (f" — {f['reason']}" if f.get("reason") else "")
                    + ("; the query filters on that column differently" if touched else ""),
                    table, fix=f"add `{expr}` to the WHERE clause for {table}"),
                    _table_node(scope, table))

    def _semijoin_satisfied(self, expr: str, scope: Scope, phys: dict[str, str],
                            preds: list[str]) -> bool:
        """Inherited `fk IN (SELECT pk FROM parent WHERE rule)` filters have a second form.

        The block may instead join the parent and apply the parent's rule directly.
        """
        try:
            node = sqlglot.parse_one(expr, read=self.L.dialect)
        except sqlglot.errors.ParseError:
            return False
        if not isinstance(node, exp.In) or not node.args.get("query"):
            return False
        query = node.args["query"]
        inner = query.this if isinstance(query, exp.Subquery) else query
        if not isinstance(inner, exp.Select):
            return False
        parent = inner.args.get("from") or inner.args.get("from_")
        where = inner.args.get("where")
        if parent is None or where is None:
            return False
        pname = parent.this.name.lower() if isinstance(parent.this, exp.Table) else ""
        if pname not in set(phys.values()):
            return False
        want = _bare(where.this, self.L.dialect)
        return any(p == want for p in preds)

    def _sums_measure_of(self, aggs: list[exp.AggFunc], table: str,
                         phys: dict[str, str]) -> bool:
        for a in aggs:
            if not isinstance(a, _ADDITIVE):
                continue
            for col in a.find_all(exp.Column):
                owner = phys.get(col.table.lower()) if col.table else (
                    table if col.name.lower() in self.L.columns.get(table, {}) else None)
                if owner == table and self.L.is_measure(table, col.name.lower()):
                    return True
        return False

    def _fanout(self, scope: Scope, phys: dict[str, str]) -> None:
        tables = set(phys.values())
        if len(tables) < 2:
            return
        seen: set[tuple[str, str]] = set()
        for a in _block_aggregates(scope):
            if not isinstance(a, _ADDITIVE):
                continue
            for col in a.find_all(exp.Column):
                parent = phys.get(col.table.lower()) if col.table else next(
                    (t for t in tables if col.name.lower() in self.L.columns.get(t, {})), None)
                if not parent:
                    continue
                for child in self.L.children.get(parent, set()) & tables:
                    if (parent, child) in seen:
                        continue
                    seen.add((parent, child))
                    self._add(Finding(
                        "fanout_aggregate", "error",
                        f"{a.sql_name()}({parent}.{col.name}) in a block that joins {child} "
                        f"(many rows per {parent}) multiplies {parent}'s values",
                        parent, col.name,
                        fix=f"aggregate {child} in a subquery first, or restrict {parent} with "
                            f"EXISTS/IN (SELECT ... FROM {child}) instead of joining it"), col)

    def _scd2(self, scope: Scope, phys: dict[str, str]) -> None:
        for alias, table in phys.items():
            t = self.L.tables.get(table)
            scd = (t or {}).get("scd")
            if not scd:
                continue
            markers = {str(scd.get(k, "")).lower()
                       for k in ("valid_from", "valid_to", "is_current_flag")}
            markers.discard("")
            used = {c.name.lower() for c in scope.expression.find_all(exp.Column)
                    if not c.table or c.table.lower() == alias}
            if markers & used:
                continue
            nk = ",".join(scd.get("natural_key") or []) or "the natural key"
            nks = [k.lower() for k in scd.get("natural_key") or []]
            distinct_nk = any(
                isinstance(a, exp.Count) and isinstance(a.this, exp.Distinct)
                and any(c.name.lower() in nks for c in a.find_all(exp.Column))
                for a in _block_aggregates(scope))
            if distinct_nk and len(set(phys.values())) == 1:
                continue
            self._add(Finding(
                "scd2_without_validity", "warning",
                f"{table} is SCD type 2 (several rows per {nk}) and the query uses neither "
                f"{scd.get('valid_from')}/{scd.get('valid_to')} nor "
                f"{scd.get('is_current_flag') or 'a current-row flag'}",
                table,
                fix=f"for attributes as of an event: AND event_date BETWEEN "
                    f"{scd.get('valid_from')} AND COALESCE({scd.get('valid_to')}, "
                    f"DATE '9999-12-31'); for current values: "
                    + (f"{scd['is_current_flag']} = 1" if scd.get("is_current_flag")
                       else f"{scd.get('valid_to')} IS NULL")),
                _table_node(scope, table))


def split_statements(text: str) -> list[tuple[str, int, int]]:
    """Each statement in `text`, with where it starts: (sql, line, offset).

    `line` is 0-based and `offset` is a character index, both pointing at the
    first non-blank character of the statement. They exist so a finding can
    be reported against the FILE rather than against the fragment it was
    linted in -- splitting on `;` and stripping, which is what this replaces,
    threw both away and left every finding on line 1.
    """
    out: list[tuple[str, int, int]] = []
    cursor = 0
    for chunk in text.split(";"):
        stripped = chunk.strip()
        if stripped:
            begin = cursor + (len(chunk) - len(chunk.lstrip()))
            out.append((stripped, text.count("\n", 0, begin), begin))
        cursor += len(chunk) + 1  # the ';' the split consumed
    return out


def to_file_positions(result: dict, line_offset: int, char_offset: int) -> dict:
    """Move a statement's findings into the coordinates of the whole file.

    Line numbers from `lint_sql` count from the start of the STATEMENT,
    because that is all it was given. A consumer that has the file -- an
    editor, a CI annotation -- needs them counted from the start of the file.
    """
    for f in result.get("findings", []):
        if f.get("line") is not None:
            f["line"] += line_offset
        for key in ("start", "end"):
            if f.get(key) is not None:
                f[key] += char_offset
    return result


def lint_sql(doc: dict, sql: str, dialect: str = "duckdb") -> dict:
    """Lint one SQL statement against the semantic layer.

    Returns {"ok": bool, "findings": [...], "errors": n, "warnings": n}.
    `ok` is False when any error-level finding exists.
    """
    if dialect not in sqlglot.dialects.Dialects.__members__.values():
        names = ", ".join(sorted(d.value for d in sqlglot.dialects.Dialects if d.value))
        f = Finding("unknown_dialect", "error",
                    f"{dialect!r} is not a SQL dialect this linter knows",
                    fix=f"pass one of: {names} (default: duckdb)")
        return {"ok": False, "findings": [asdict(f)], "errors": 1, "warnings": 0}
    layer = _Layer(doc, dialect)
    try:
        tree = sqlglot.parse_one(sql, read=dialect)
    except sqlglot.errors.ParseError as e:
        f = Finding("parse_error", "error", f"SQL does not parse as {dialect}: {str(e)[:160]}")
        return {"ok": False, "findings": [asdict(f)], "errors": 1, "warnings": 0}
    linter = _Linter(layer)
    try:
        scopes = traverse_scope(tree)
    except Exception:  # pragma: no cover - sqlglot cannot scope exotic statements
        scopes = []
    for scope in scopes:
        if isinstance(scope.expression, exp.Select):
            linter.block(scope)
    findings = [asdict(f) for f in linter.findings]
    errors = sum(1 for f in findings if f["severity"] == "error")
    warnings = sum(1 for f in findings if f["severity"] == "warning")
    return {"ok": errors == 0, "findings": findings, "errors": errors, "warnings": warnings}


def without_positions(result: dict) -> dict:
    """The same findings, with the position fields removed.

    For the payloads a MODEL sees. Positions are for a consumer holding the
    source text -- an editor drawing a squiggle, a CI job annotating a diff
    -- and an agent that called `check_sql` with a string it composed gains
    little from them.

    The reason they are removed rather than simply not useful: every
    agent-facing payload is pinned by a recorded cassette, so adding four
    keys to it invalidates every recorded answer and turns a replay suite
    red. That is a real cost (live calls, paid, and a partial re-record
    leaves half the published benchmark rows stale) against a marginal gain.
    Revisit when something is being re-recorded anyway.
    """
    stripped = dict(result)
    stripped["findings"] = [
        {k: v for k, v in f.items() if k not in _POSITION_KEYS}
        for f in result.get("findings", [])
    ]
    return stripped


def render_findings(result: dict, file: str = "") -> str:
    """Plain-text rendering used by the CLI and by consumers feeding findings back to an agent."""
    if not result["findings"]:
        return "OK: no findings"
    lines = []
    for f in result["findings"]:
        loc = (f"{f['table']}.{f['column']}" if f.get("table") and f.get("column")
               else (f.get("table") or ""))
        # `file:line:col` first, because most terminals make it clickable and
        # it is the only part of this that takes you to the problem.
        #
        # ONLY when a file was named. This text is not just for a terminal:
        # the CQ harness feeds it back to the model as the repair prompt, so
        # changing it changes a cassette key and invalidates every recorded
        # answer. Adding a position unconditionally did exactly that and the
        # release gate caught it. A caller with a file to name is a caller
        # printing for a human; everyone else gets the text they had.
        at = (f"{file}:{f['line']}:{f['col']}: "
              if file and f.get("line") is not None else "")
        lines.append(f"{at}[{f['severity']}] {f['rule']}"
                     f"{' ' + loc if loc else ''}: {f['message']}")
        if f.get("fix"):
            lines.append(f"    fix: {f['fix']}")
    return "\n".join(lines)

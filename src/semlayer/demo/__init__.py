"""A warehouse to try semlayer on, for people who do not have one to hand.

`semlayer demo` writes a DuckDB file holding `messy_mart`: thirty-six tables
built to look like a real enterprise estate rather than a tutorial schema.
Cryptic names (`ord_hdr`, `cust_mstr`, `tot_amt`), no declared primary or
foreign keys anywhere in the DDL, an SCD2 customer dimension, two aggregate
tables that reconcile with their facts only under a filter nobody wrote down,
two deprecated legacy tables, and enum columns whose decode table exists for
some and not others.

That last part is the point. A clean tutorial schema proves nothing: the
claim semlayer makes is about warehouses where the keys are undeclared and
the rules are unwritten, so the thing we hand a new user has to be one of
those. Everything the engine finds here, it finds without help from the
catalog.

It lives in the package rather than in `fixtures/` because a person who
installed from PyPI has no copy of the repository -- which is exactly the
person who needs a warehouse to try.

Deterministic in its DATA: one seeded RNG, so the same thirty-six tables
with the same rows every time. Not byte-identical -- DuckDB writes its
own timestamps into the file -- so compare what it holds, never its hash.
"""
from __future__ import annotations

from pathlib import Path

from semlayer.demo.messy_mart import NAME
from semlayer.demo.messy_mart import build as _build

__all__ = ["NAME", "build"]


def build(out: Path) -> Path:
    """Write the demo warehouse to `out` and return the path.

    Overwrites: the file is generated, so a stale one from an older version is
    never what the caller wanted.
    """
    import duckdb

    out = Path(out).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()

    con = duckdb.connect(str(out))
    try:
        _build(con)
    finally:
        con.close()
    return out

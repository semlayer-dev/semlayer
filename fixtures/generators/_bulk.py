"""Bulk insert helper, re-exported from the package.

It moved to `semlayer.demo._bulk` with the messy_mart generator, which needs
to ship in the wheel for `semlayer demo`. The other generators import it from
here, so this shim keeps one copy of the code and two ways to reach it.
"""

from semlayer.demo._bulk import bulk_insert, bulk_insert_sql

__all__ = ["bulk_insert", "bulk_insert_sql"]

"""messy_mart, re-exported from the package.

The generator moved to `semlayer.demo.messy_mart` so it ships in the wheel:
`semlayer demo` needs it, and a user who installed from PyPI has no copy of
this directory. One source of truth, imported from both places.
"""

from semlayer.demo.messy_mart import NAME, SEED, build

__all__ = ["NAME", "SEED", "build"]

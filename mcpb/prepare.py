# SPDX-License-Identifier: FSL-1.1-ALv2
"""Pin the bundle to the version being released, and print that version.

The bundle asks PyPI for `semlayer[warehouses]==<version>` at install time,
so the pin has to match the release exactly -- a bundle that floats would
install a different engine than the one it shipped beside, and a bundle
pinned to an unpublished version cannot install at all.

Run from the repository root. Prints the version, so the workflow can name
the artifact without parsing anything twice.
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def version() -> str:
    """The engine version this release is publishing."""
    text = (ROOT / "pyproject.toml").read_text()
    m = re.search(r'^version = "(.+)"$', text, re.M)
    if not m:
        raise SystemExit("no version in pyproject.toml")
    return m.group(1)


def main() -> int:
    """Pin the manifest and the dependency, then print the version."""
    v = version()

    manifest = ROOT / "mcpb" / "manifest.json"
    doc = json.loads(manifest.read_text())
    doc["version"] = v
    manifest.write_text(json.dumps(doc, indent=2) + "\n")

    deps = ROOT / "mcpb" / "pyproject.toml"
    text = deps.read_text()
    # Count the substitutions rather than comparing the text: re-pinning an
    # already-correct line is a no-op and must not look like a failure, while
    # a dependency line that has been renamed away must.
    pinned, n = re.subn(r'semlayer\[warehouses\][^"]*',
                        f"semlayer[warehouses]=={v}", text)
    if n != 1:
        raise SystemExit(f"expected one semlayer[warehouses] dependency, found "
                         f"{n}; refusing to ship an unpinned bundle")
    deps.write_text(pinned)

    print(v)  # noqa: T201 -- stdout IS this script's interface
    return 0


if __name__ == "__main__":
    sys.exit(main())

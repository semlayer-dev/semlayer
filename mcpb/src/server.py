"""Entry point for the semlayer MCP bundle.

The bundle declares `semlayer[warehouses]` as a dependency and the host
installs it with uv, so this file is the whole of the "server" -- it hands
straight off to the CLI the rest of the world uses. Nothing is special-cased
for the bundle; a bug here would be a bug everywhere.

`SEMLAYER_LAYER` is how the layer path reaches us: a bundle's user settings
arrive as environment variables, and with none set the server starts without
a layer, which is the right first run -- it reports the warehouses it can see
and offers to build one.
"""

import os
import sys

from semlayer.cli import main

args = ["mcp"]
layer = os.environ.get("SEMLAYER_LAYER", "").strip()
if layer:
    args.append(layer)

sys.exit(main(args))

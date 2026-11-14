"""The MCP bundle: small, pinned, and not vendoring anything.

A `.mcpb` is a one-click install for Claude Desktop. The whole reason this
one is kilobytes is `server.type: "uv"` -- the host resolves dependencies
from PyPI at install time. The `python` type would have meant vendoring
pyarrow, the Snowflake connector and the BigQuery client, once per platform,
and the spec forbids `server/lib` and `server/venv` in a uv bundle anyway.

The asymmetry worth knowing, because it is the opposite of the guess: a
BUNDLE declaring `type: "uv"` gets Desktop's built-in MCPB runtime, which
manages the uv and Python environment and installs dependencies on first
launch with nothing pre-installed. A hand-written `claude_desktop_config.json`
gets no such thing -- Desktop does not bundle uv, and launches servers as GUI
subprocesses with a restricted PATH, so a bare `"command": "uvx"` there fails
with `spawn uv ENOENT`. (Node is the opposite again: Desktop embeds a Node
runtime.) That is why `semlayer client add` writes absolute paths and why
this bundle exists at all.

Verified locally before shipping: `uv run --directory mcpb src/server.py`
creates the environment, installs 65 packages and answers an MCP
`initialize` with our own serverInfo -- which is exactly what the host does.
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MCPB = ROOT / "mcpb"


def _manifest() -> dict:
    return json.loads((MCPB / "manifest.json").read_text())


def test_the_bundle_does_not_vendor_dependencies():
    m = _manifest()
    assert m["server"]["type"] == "uv", (
        "the python type requires vendoring every wheel, per platform")
    assert not (MCPB / "server" / "lib").exists()
    assert not (MCPB / "server" / "venv").exists()
    assert (MCPB / "pyproject.toml").exists(), "uv needs the dependency list"


def test_the_entry_point_exists_and_is_the_real_cli():
    m = _manifest()
    entry = MCPB / m["server"]["entry_point"]
    assert entry.exists()
    src = entry.read_text()
    assert "from semlayer.cli import main" in src, (
        "the bundle must hand off to the CLI everyone else runs, not a "
        "special-cased copy")


def test_the_dependency_is_pinned_to_a_release():
    """A floating bundle installs a different engine than it shipped beside."""
    deps = (MCPB / "pyproject.toml").read_text()
    assert re.search(r'semlayer\[warehouses\]==\d', deps), deps


def test_prepare_pins_the_bundle_to_the_engine_version():
    out = subprocess.run([sys.executable, str(MCPB / "prepare.py")],
                         capture_output=True, text=True, check=True, cwd=ROOT)
    version = out.stdout.strip()

    engine = re.search(r'^version = "(.+)"$',
                       (ROOT / "pyproject.toml").read_text(), re.M).group(1)
    assert version == engine
    assert _manifest()["version"] == engine
    assert f"semlayer[warehouses]=={engine}" in (MCPB / "pyproject.toml").read_text()


def test_the_layer_is_optional_so_a_first_run_works():
    """With no layer the server reports what it can see and offers to build
    one -- which is the whole first-run story. A required field here would
    make the bundle unusable by exactly the person it is for."""
    cfg = _manifest()["user_config"]
    assert cfg["layer"]["required"] is False
    assert cfg["anthropic_api_key"]["required"] is False
    assert cfg["anthropic_api_key"]["sensitive"] is True


def test_user_config_reaches_the_server():
    """The values a host collects have to arrive as environment variables,
    and `server.py` reads SEMLAYER_LAYER. If these two drift the settings
    dialog collects a path that nothing ever uses."""
    env = _manifest()["server"]["mcp_config"]["env"]
    assert env["SEMLAYER_LAYER"] == "${user_config.layer}"
    assert "SEMLAYER_LAYER" in (MCPB / "src" / "server.py").read_text()

# SPDX-License-Identifier: FSL-1.1-ALv2
"""Writing semlayer into an MCP client's config, so nobody hand-edits JSON.

Hand-editing is the step that loses people, and it fails in three ways that
have all been observed:

  * The snippet lands in the wrong place. A bare ``"semlayer": {...}`` does
    not say that it belongs inside ``mcpServers``, and at the top level of
    the file it is silently inert.
  * The command is a bare name. A client launched from a dock or a desktop
    icon does not inherit a shell's PATH, so ``semlayer`` resolves in your
    terminal and not in the client, which reports ``executable not found``.
  * An editor's own process rewrites the file. Claude Code keeps session
    state in the same JSON, so an edit made while it is running can be
    overwritten by its next write.

The VS Code extension solved this in TypeScript for the people who install
it. This is the same thing for everyone else -- a terminal user, a container,
and above all an agent that was asked to "install the semlayer MCP server"
and would otherwise be editing JSON by hand on someone's machine.

What it will not do: invent a client. The four here are the ones whose config
shape is known and exercised. An unknown name is an error that lists what is
known, rather than a guess at a path.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from semlayer.errors import SemlayerError


@dataclass(frozen=True)
class Client:
    """An MCP client this machine might have, and where its config lives."""

    id: str
    label: str
    path: Path
    #: The key servers live under. VS Code calls it `servers`; everyone else
    #: `mcpServers`. Recorded per client rather than assumed, because writing
    #: the wrong key produces a config that parses and does nothing.
    key: str = "mcpServers"

    @property
    def exists(self) -> bool:
        """Whether this client has a config file here at all."""
        return self.path.exists()


def _home(*parts: str) -> Path:
    return Path.home().joinpath(*parts)


def _desktop_config() -> Path:
    """Claude Desktop keeps its config somewhere different on every platform."""
    system = platform.system()
    if system == "Darwin":
        return _home("Library", "Application Support", "Claude",
                     "claude_desktop_config.json")
    if system == "Windows":
        appdata = os.environ.get("APPDATA")
        base = Path(appdata) if appdata else _home("AppData", "Roaming")
        return base / "Claude" / "claude_desktop_config.json"
    return _home(".config", "Claude", "claude_desktop_config.json")


def _vscode_config() -> Path:
    """VS Code's own agent, via Copilot's portable config.

    NOT `.vscode/mcp.json`. That is the editor-managed format, it is scoped
    to one workspace, and VS Code's own documentation marks it deprecated
    with removal in February 2027 -- writing it would be shipping a path
    with an expiry date on it. The portable file is user-level, is what the
    docs point new configurations at, and uses the same `mcpServers` shape
    as every other client here.

    `COPILOT_HOME` moves it, the same way `SEMLAYER_HOME` moves ours.
    """
    base = os.environ.get("COPILOT_HOME")
    return (Path(base) if base else _home(".copilot")) / "mcp-config.json"


def clients() -> list[Client]:
    """The clients we know how to write, in the order worth offering them."""
    return [
        Client("claude-code", "Claude Code", _home(".claude.json")),
        Client("claude-desktop", "Claude Desktop", _desktop_config()),
        Client("cursor", "Cursor", _home(".cursor", "mcp.json")),
        Client("cline", "Cline",
               _home(".cline", "data", "settings", "cline_mcp_settings.json")),
        Client("vscode", "VS Code (Copilot)", _vscode_config()),
    ]


def find(name: str) -> Client:
    """One client by id, or an error naming the ones that exist."""
    for c in clients():
        if c.id == name:
            return c
    known = ", ".join(c.id for c in clients())
    raise SemlayerError(f"{name!r} is not a client semlayer knows how to configure",
                        hint=f"one of: {known}")


def command_for(cli: str | None = None) -> list[str]:
    """How a DIFFERENT process should invoke this engine.

    An absolute path, because the client is another process with another
    environment: `~/.local/bin` is exactly the directory a desktop app
    launched from a dock cannot see, and a bare `semlayer` that works in your
    terminal fails there with `executable not found`.

    Falls back to `<this python> -m semlayer.cli` when no launcher is on
    PATH, which is the normal state inside a venv that was never activated
    for the client.
    """
    found = shutil.which(cli or "semlayer")
    if found:
        # Absolute, but NOT symlink-resolved. `uv tool install` leaves a shim
        # at `~/.local/bin/semlayer` pointing into its own tool directory;
        # the shim is the stable, documented path (`which semlayer` prints
        # it) and the target is uv's private layout, which it may rearrange.
        return [os.path.abspath(found)]
    return [sys.executable, "-m", "semlayer.cli"]


def entry(layer: str | Path | None = None, cli: str | None = None) -> dict:
    """The `mcpServers.semlayer` value: command and arguments kept separate.

    Separate because they are separate fields in every client's schema. A
    whole argv joined into `command` names an executable that cannot exist --
    the mistake is invisible for a plain binary and fatal for anything with
    arguments, such as a `uvx` invocation.
    """
    argv = command_for(cli)
    args = [*argv[1:], "mcp"]
    if layer is not None:
        args.append(str(Path(layer).expanduser().resolve()))
    return {"command": argv[0], "args": args}


def read_config(path: Path) -> dict:
    """Parse a client's config, or start an empty one.

    A file that is not JSON is an ERROR, not an empty dict: it is the user's
    file and probably holds other servers, and overwriting it would be the
    worst outcome this module can produce.
    """
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if not text:
        return {}
    try:
        value = json.loads(text)
    except json.JSONDecodeError as e:
        raise SemlayerError(f"{path} is not valid JSON ({e})",
                            hint="fix or move the file; refusing to overwrite "
                                 "a config that may hold other servers") from e
    if not isinstance(value, dict):
        raise SemlayerError(f"{path} does not hold a JSON object")
    return value


def plan(client: Client, layer: str | Path | None = None,
         cli: str | None = None) -> dict:
    """What `apply` would do, without doing it.

    Returns the merged config and a verdict, so a caller can show the user
    the change before it happens and an agent can report it.
    """
    config = read_config(client.path)
    servers = config.get(client.key)
    servers = dict(servers) if isinstance(servers, dict) else {}
    before = servers.get("semlayer")
    after = entry(layer, cli)
    merged = dict(config)
    merged[client.key] = {**servers, "semlayer": after}
    return {
        "client": client.id,
        "path": str(client.path),
        "existed": client.path.exists(),
        "before": before,
        "after": after,
        "unchanged": before == after,
        # Everything else in the file is carried through untouched. Named in
        # the plan so a reviewer can see what is NOT being rewritten.
        "other_servers": sorted(k for k in servers if k != "semlayer"),
        "merged": merged,
    }


def apply(client: Client, layer: str | Path | None = None,
          cli: str | None = None) -> dict:
    """Write the entry, preserving every other key in the file."""
    result = plan(client, layer, cli)
    client.path.parent.mkdir(parents=True, exist_ok=True)
    client.path.write_text(json.dumps(result["merged"], indent=2) + "\n",
                           encoding="utf-8")
    return result


def warning_for(client: Client) -> str | None:
    """What is true about this client that a user has to know afterwards.

    Both of these have cost a person an evening, so they are returned rather
    than left to the reader of a doc.
    """
    if client.id == "claude-code":
        return ("Claude Code keeps session state in this same file and can "
                "overwrite an edit made while it is running. Quit it first, "
                "or use `claude mcp add semlayer -- <command> mcp`, which "
                "writes it through the client itself.")
    return None


RESTART_NOTE = ("Start a NEW session of the client before asking it anything: "
                "an MCP client reads its server list once, at startup, so one "
                "that was already running has never seen this entry.")

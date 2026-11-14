"""Writing semlayer into an MCP client's config.

Every assertion here is a mistake someone actually made on a real machine,
mostly in one evening:

  * a `"semlayer": {...}` snippet pasted at the TOP LEVEL of ~/.claude.json,
    because the instruction did not say it belonged inside `mcpServers`;
  * a bare `semlayer` as the command, which resolves in a terminal and not
    in a client launched from a dock;
  * an argv joined into one string, naming an executable that cannot exist.

The point of the command these test is that none of those are reachable.
"""

from __future__ import annotations

import json

import pytest

from semlayer import mcp_install as mi
from semlayer.errors import SemlayerError


def _client(tmp_path, name="claude-code", key="mcpServers"):
    return mi.Client(name, name.title(), tmp_path / "cfg.json", key)


# --- the entry itself -------------------------------------------------------

def test_the_command_is_absolute(tmp_path, monkeypatch):
    """A bare name resolves in your shell and not in the client's process."""
    fake = tmp_path / "bin" / "semlayer"
    fake.parent.mkdir()
    fake.write_text("#!/bin/sh\n")
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", str(fake.parent))

    e = mi.entry()
    assert e["command"] == str(fake)
    assert e["args"] == ["mcp"]


def test_arguments_stay_arguments(tmp_path, monkeypatch):
    """Never one joined string: that names an executable that cannot exist."""
    monkeypatch.setenv("PATH", str(tmp_path))      # nothing on PATH
    e = mi.entry()
    assert " " not in e["command"], "a command with a space in it is not a command"
    assert e["args"][-1] == "mcp"
    # With no launcher found, the fallback must still be runnable.
    assert e["command"].endswith("python") or "python" in e["command"]


def test_a_layer_is_recorded_absolutely(tmp_path, monkeypatch):
    """A relative path means something different in the client's cwd."""
    monkeypatch.setenv("PATH", str(tmp_path))
    layer = tmp_path / "messy_mart.yaml"
    layer.write_text("semantic_layer: {}\n")
    monkeypatch.chdir(tmp_path)

    e = mi.entry("messy_mart.yaml")
    assert e["args"][-1] == str(layer)


# --- merging into a file that is not ours -----------------------------------

def test_other_servers_and_unrelated_keys_survive(tmp_path):
    c = _client(tmp_path)
    c.path.write_text(json.dumps({
        "mcpServers": {"github": {"command": "gh-mcp"}},
        "numStartups": 41,
        "projects": {"/home/u/x": {"allowedTools": []}},
    }))

    mi.apply(c)
    after = json.loads(c.path.read_text())

    assert after["mcpServers"]["github"] == {"command": "gh-mcp"}
    assert after["numStartups"] == 41
    assert after["projects"] == {"/home/u/x": {"allowedTools": []}}
    assert "semlayer" in after["mcpServers"]


def test_the_entry_goes_INSIDE_mcpservers(tmp_path):
    """The mistake that started this: a top-level key is silently inert."""
    c = _client(tmp_path)
    mi.apply(c)
    after = json.loads(c.path.read_text())
    assert "semlayer" in after["mcpServers"]
    assert "semlayer" not in {k for k in after if k != "mcpServers"}


def test_a_client_that_calls_the_key_something_else(tmp_path):
    """VS Code says `servers`. Writing the wrong key parses and does nothing."""
    c = _client(tmp_path, "vscode", key="servers")
    mi.apply(c)
    after = json.loads(c.path.read_text())
    assert "semlayer" in after["servers"]
    assert "mcpServers" not in after


def test_a_missing_config_is_created_with_its_directory(tmp_path):
    c = mi.Client("cline", "Cline", tmp_path / "deep" / "nested" / "cfg.json")
    assert not c.exists
    mi.apply(c)
    assert json.loads(c.path.read_text())["mcpServers"]["semlayer"]


def test_invalid_json_is_refused_not_overwritten(tmp_path):
    """It is the user's file and probably holds other servers."""
    c = _client(tmp_path)
    c.path.write_text('{"mcpServers": {"github": {}},,,')
    with pytest.raises(SemlayerError, match="not valid JSON"):
        mi.apply(c)
    assert c.path.read_text().endswith(",,,"), "the file must be left alone"


# --- the plan, and saying what will happen before it happens ----------------

def test_dry_run_writes_nothing(tmp_path):
    c = _client(tmp_path)
    before = json.dumps({"mcpServers": {}})
    c.path.write_text(before)

    result = mi.plan(c)
    assert result["after"]["args"][-1] == "mcp"
    assert c.path.read_text() == before, "plan must not touch the file"


def test_rewriting_the_same_entry_is_reported_as_unchanged(tmp_path):
    c = _client(tmp_path)
    mi.apply(c)
    again = mi.plan(c)
    assert again["unchanged"] is True
    assert again["before"] == again["after"]


def test_the_plan_names_what_it_is_not_touching(tmp_path):
    c = _client(tmp_path)
    c.path.write_text(json.dumps({"mcpServers": {"a": {}, "b": {}}}))
    assert mi.plan(c)["other_servers"] == ["a", "b"]


# --- knowing what it does not know ------------------------------------------

def test_an_unknown_client_lists_the_known_ones(tmp_path):
    with pytest.raises(SemlayerError) as e:
        mi.find("windsurf")
    assert "claude-code" in str(e.value.hint)


def test_every_known_client_has_a_distinct_id_and_path():
    cs = mi.clients()
    assert len({c.id for c in cs}) == len(cs)
    assert len({str(c.path) for c in cs}) == len(cs)
    assert {c.id for c in cs} == {"claude-code", "claude-desktop", "cursor",
                                  "cline", "vscode"}


def test_vscode_is_the_portable_file_not_the_deprecated_workspace_one(monkeypatch):
    """`.vscode/mcp.json` is editor-managed, workspace-scoped, and VS Code's
    own docs mark it for removal in February 2027. The portable Copilot file
    is user-level and is what new configurations are pointed at."""
    monkeypatch.delenv("COPILOT_HOME", raising=False)
    c = mi.find("vscode")
    assert c.path.name == "mcp-config.json"
    assert ".copilot" in str(c.path)
    assert ".vscode" not in str(c.path)
    assert c.key == "mcpServers", "the portable format, same as every other client"


def test_copilot_home_moves_the_vscode_config(monkeypatch, tmp_path):
    monkeypatch.setenv("COPILOT_HOME", str(tmp_path / "elsewhere"))
    assert mi.find("vscode").path == tmp_path / "elsewhere" / "mcp-config.json"


def test_claude_code_warns_about_the_file_it_shares_with_itself():
    """It keeps session state in the same JSON and can overwrite an edit."""
    warn = mi.warning_for(mi.find("claude-code"))
    assert warn and "overwrite" in warn
    assert mi.warning_for(mi.find("cursor")) is None


def test_the_restart_note_says_what_restart_means():
    assert "NEW session" in mi.RESTART_NOTE
    assert "startup" in mi.RESTART_NOTE

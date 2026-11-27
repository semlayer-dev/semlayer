"""The Glama launcher: the standard server plus two prompts, and the standard
server left exactly as it was."""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import anyio
import pytest

from semlayer import mcp_server
from semlayer.session import Session

SCRIPT = Path(__file__).resolve().parents[1] / "examples" / "glama" / "server.py"
LAYER = Path(__file__).resolve().parents[1] / "fixtures" / "golds" / "messy_mart.yaml"

# Words the prompts put in backticks that are fields of a result, not tools.
FIELDS = {"next", "truncated", "signal", "agent", "gates_behaviour"}


@pytest.fixture(scope="module")
def srv():
    spec = importlib.util.spec_from_file_location("glama_server", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.build(str(LAYER))


def _text(srv, name: str) -> str:
    return anyio.run(lambda: srv.get_prompt(name, {})).messages[0].content.text


def test_the_starter_prompts_are_offered_with_no_arguments(srv):
    prompts = {p.name: p for p in anyio.run(srv.list_prompts)}
    assert {"setup", "explore", "audit"} <= set(prompts)
    for name in ("explore", "audit"):
        assert prompts[name].description
        assert not prompts[name].arguments, "a click cannot fill one in"


def test_the_starter_prompts_name_only_tools_that_exist(srv):
    """A prompt that sends an agent to a renamed tool fails in front of the
    one visitor who clicked it."""
    tools = {t.name for t in anyio.run(srv.list_tools)}
    for name in ("explore", "audit"):
        text = _text(srv, name)
        named = set(re.findall(r"`([a-z_]+)`", text)) - FIELDS
        assert named, name
        assert named <= tools, named - tools
        assert text.index("`status`") == min(text.index(f"`{t}`") for t in named)


def test_the_audit_prompt_never_lets_the_agent_decide(srv):
    assert "never record one of your own" in _text(srv, "audit")


def test_the_launcher_serves_the_layer_it_was_given(srv):
    out = anyio.run(lambda: srv.call_tool("get_metrics", {}))
    assert "no layer" not in str(out).lower()


def test_the_standard_server_does_not_gain_them():
    """They assume a layer at startup, which `semlayer mcp` does not."""
    plain = mcp_server.build_server(Session())
    assert {p.name for p in anyio.run(plain.list_prompts)} == {"setup"}

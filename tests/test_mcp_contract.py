"""The MCP server's contract with its clients, checked over real stdio.

Every other MCP test calls the tool functions in-process. This one speaks
JSON-RPC to a spawned `semlayer mcp`, because that is what a client does, and
the things that break there are invisible from inside: a tool that fails to
register, a version that reports the SDK's instead of ours, instructions that
never reach the handshake.

It is the MCP half of the extension's feature manifest, and it is written the
same way -- a list of what the server claims, each entry carrying the evidence.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

# What a client must find. Grouped the way the server registers them, because
# a whole group vanishing (no layer loaded, say) is the failure worth naming.
SESSION_TOOLS = {"status", "discover_connections", "load_layer"}
BUILD_TOOLS = {"infer", "cancel_infer", "context_for_question", "run_sql"}
REVIEW_TOOLS = {"review_questions", "review_question", "review_answer",
                "review_decisions", "save_layer", "export_layer"}
DOCUMENT_TOOLS = {"semantic_search", "get_domains", "get_tables", "table_detail",
                  "get_metrics", "route_intent", "check_sql", "compile_metric"}
ALL_TOOLS = SESSION_TOOLS | BUILD_TOOLS | REVIEW_TOOLS | DOCUMENT_TOOLS


class Client:
    """The smallest MCP client that can hold the server to its contract."""

    def __init__(self, proc: subprocess.Popen[str]) -> None:
        self.proc = proc
        self._id = 0

    def send(self, method: str, params: dict | None = None, *, notify: bool = False) -> None:
        msg: dict = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if not notify:
            self._id += 1
            msg["id"] = self._id
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()

    def read(self) -> dict:
        assert self.proc.stdout is not None
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise AssertionError("the server closed stdout before answering")
            line = line.strip()
            if line.startswith("{"):
                return json.loads(line)

    def call(self, method: str, params: dict | None = None) -> dict:
        self.send(method, params)
        reply = self.read()
        assert "error" not in reply, f"{method} failed: {reply['error']}"
        return reply["result"]


@pytest.fixture
def server(tmp_path: Path):
    """A server with no layer: the state every first-run client meets."""
    proc = subprocess.Popen(
        [sys.executable, "-m", "semlayer.cli", "mcp"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, bufsize=1, cwd=tmp_path,
    )
    client = Client(proc)
    init = client.call("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "contract-test", "version": "0"},
    })
    client.send("notifications/initialized", notify=True)
    try:
        yield client, init
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_handshake_reports_our_version_not_the_sdk(server) -> None:
    """The server once announced the MCP SDK's version as its own.

    A client has no other way to know what it is talking to, and `1.28.1` in a
    bug report is unactionable.
    """
    from semlayer import __version__

    _, init = server
    info = init["serverInfo"]
    assert info["name"] == "semlayer"
    assert info["version"] == __version__, (
        f"the handshake says {info['version']}, the package says {__version__}")


def test_handshake_carries_instructions(server) -> None:
    """Instructions are how a client learns to call context_for_question first.

    Without them an agent sees twenty-one tools and no order to use them in.
    """
    _, init = server
    text = init.get("instructions") or ""
    assert text, "the server sent no instructions"
    assert "status" in text, "the instructions do not tell a client to call status first"
    assert "context_for_question" in text


def test_every_tool_is_registered(server) -> None:
    client, _ = server
    names = {t["name"] for t in client.call("tools/list")["tools"]}
    missing = ALL_TOOLS - names
    assert not missing, f"missing tools: {sorted(missing)}"


@pytest.mark.parametrize("group,label", [
    (SESSION_TOOLS, "session"),
    (BUILD_TOOLS, "build and answer"),
    (REVIEW_TOOLS, "review"),
    (DOCUMENT_TOOLS, "document"),
])
def test_tool_group_is_present(server, group: set[str], label: str) -> None:
    """Named per group so a failure says WHICH registration stopped running."""
    client, _ = server
    names = {t["name"] for t in client.call("tools/list")["tools"]}
    assert group <= names, f"the {label} tools are not registered: {sorted(group - names)}"


def test_every_tool_describes_itself(server) -> None:
    """A tool with no description is a tool an agent will not choose."""
    client, _ = server
    for tool in client.call("tools/list")["tools"]:
        assert tool.get("description", "").strip(), f"{tool['name']} has no description"
        assert "inputSchema" in tool, f"{tool['name']} has no input schema"


def test_context_for_question_is_the_documented_entry_point(server) -> None:
    """Its description is load-bearing: it is what makes an agent start there."""
    client, _ = server
    tools = {t["name"]: t for t in client.call("tools/list")["tools"]}
    assert "START EVERY QUESTION HERE" in tools["context_for_question"]["description"].upper()


def test_with_no_layer_every_tool_says_what_to_do_next(server) -> None:
    """The first-run contract: no layer is a state, not an error.

    Every tool answers with the same object and a `next` sentence, so an agent
    that called the wrong one still learns where to go.
    """
    client, _ = server
    for name in ("semantic_search", "get_tables", "get_metrics"):
        result = client.call("tools/call", {"name": name, "arguments": {"query": "x"}
                                            if name == "semantic_search" else {}})
        text = "".join(c.get("text", "") for c in result.get("content", []))
        assert "next" in text.lower(), f"{name} did not say what to do next"


def test_setup_prompt_is_offered(server) -> None:
    """The walkthrough a user gets by asking, rather than a questionnaire."""
    client, _ = server
    names = {p["name"] for p in client.call("prompts/list")["prompts"]}
    assert "setup" in names

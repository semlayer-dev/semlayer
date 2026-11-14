"""Which model a run uses, and how a user says so.

The engine pinned Haiku in a constant with no way past it. That is the right
default -- the published cost model and every committed cassette are measured
on it -- but "the model is whatever we compiled in" is not a thing a product
can tell someone who wants better descriptions than the cheap tier writes.
`--model` and `SEMLAYER_MODEL` are the two ways to say otherwise, and this
file is the proof that each reaches a real API call rather than a form field
that does nothing.
"""

from __future__ import annotations

import pytest

from semlayer.llm.provider import CHEAP_MODEL, AnthropicProvider, resolve_model


def test_the_default_is_still_the_cheap_tier(tmp_path, monkeypatch):
    monkeypatch.setenv("SEMLAYER_HOME", str(tmp_path))
    assert resolve_model() == CHEAP_MODEL
    assert resolve_model(None) == CHEAP_MODEL
    assert resolve_model("   ") == CHEAP_MODEL, "whitespace is not a model id"


def test_the_env_file_can_name_a_model(tmp_path, monkeypatch):
    """The same file the API key comes from, because MCP has no shell.

    A user running the server from Claude Desktop cannot export a variable
    where the server will see it; `$SEMLAYER_HOME/.env` is the one channel
    that works, and it is where they already put ANTHROPIC_API_KEY.
    """
    monkeypatch.setenv("SEMLAYER_HOME", str(tmp_path))
    (tmp_path / ".env").write_text("SEMLAYER_MODEL=claude-opus-4-5-20251101\n")
    assert resolve_model() == "claude-opus-4-5-20251101"
    assert resolve_model("claude-sonnet-4-5") == "claude-sonnet-4-5", "a flag beats the file"


def test_the_model_is_part_of_the_cassette_key(tmp_path, monkeypatch):
    """Two models must not share a recorded answer.

    The cassette holds what one model said. Replaying it for another would
    report a run that never happened, which is worse than paying for the
    calls.
    """
    monkeypatch.setenv("SEMLAYER_HOME", str(tmp_path))
    a = AnthropicProvider(cassette_dir=tmp_path, allow_live=False)
    b = AnthropicProvider("claude-opus-4-5-20251101", cassette_dir=tmp_path, allow_live=False)
    assert a._key("sys", "user") != b._key("sys", "user")


def test_infer_hands_the_flag_to_the_provider(monkeypatch):
    """`semlayer infer --model X` must build the provider with X.

    Recorded at construction and then aborted, so the test costs nothing and
    cannot depend on what any model would have replied.
    """
    from semlayer import cli

    seen: list[str | None] = []

    class _Recorder:
        def __init__(self, model=None, *a, **kw):
            seen.append(model)
            raise _Stop

    class _Stop(Exception):
        pass

    monkeypatch.setattr("semlayer.llm.provider.AnthropicProvider", _Recorder)
    with pytest.raises(_Stop):
        cli.main(["infer", "duckdb:nonexistent.duckdb", "--model", "claude-opus-4-5-20251101"])
    assert seen == ["claude-opus-4-5-20251101"]


def test_maintain_takes_the_same_flag(monkeypatch):
    """Re-inference must be able to keep using the model that built the layer."""
    from semlayer import cli

    args = cli._build_parser().parse_args(
        ["maintain", "doc.yaml", "duckdb:x.duckdb", "--model", "claude-sonnet-4-5"])
    assert args.model == "claude-sonnet-4-5"

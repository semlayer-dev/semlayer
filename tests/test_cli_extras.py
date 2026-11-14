"""M1 leftovers: init grant scripts + telemetry opt-out."""

import subprocess
import sys
from pathlib import Path

OSS = Path(__file__).resolve().parent.parent


def test_init_snowflake_renders_minimal_grant():
    from semlayer.init_cmd import render
    sql = render("snowflake", database="proddb", warehouse_name="wh1")
    assert "GRANT SELECT ON FUTURE TABLES IN DATABASE proddb" in sql
    assert "GRANT USAGE ON WAREHOUSE wh1" in sql
    # the drift grant must be commented OPT-IN, never active by default
    active = [line for line in sql.splitlines()
              if "IMPORTED PRIVILEGES" in line and not line.strip().startswith("--")]
    assert not active


def test_init_bigquery_renders_minimal_grant():
    from semlayer.init_cmd import render
    sh = render("bigquery", project="p1")
    assert "roles/bigquery.dataViewer" in sh
    active = [line for line in sh.splitlines()
              if "resourceViewer" in line and not line.strip().startswith("#")]
    assert not active


def test_telemetry_opt_out(tmp_path, monkeypatch):
    monkeypatch.setenv("SEMLAYER_HOME", str(tmp_path))
    monkeypatch.setenv("SEMLAYER_TELEMETRY", "off")
    import importlib
    from semlayer import telemetry
    importlib.reload(telemetry)
    telemetry.record("test_event", n=1)
    assert not (tmp_path / "telemetry.jsonl").exists()


def test_telemetry_records_no_content(tmp_path, monkeypatch):
    monkeypatch.setenv("SEMLAYER_HOME", str(tmp_path))
    monkeypatch.delenv("SEMLAYER_TELEMETRY", raising=False)
    import importlib
    from semlayer import telemetry
    importlib.reload(telemetry)
    telemetry.record("cli", command="validate")
    line = (tmp_path / "telemetry.jsonl").read_text()
    assert "cli" in line and "anon" in line


def test_snowflake_does_not_require_a_role_to_be_named(monkeypatch):
    """A missing role is no longer a wall. It used to be.

    The requirement was protecting a real property -- a minimal-grant claim
    is about the role in effect, and inheriting DEFAULT_ROLE profiles under
    whatever privileges the account holds. But the report recorded the role
    we had been handed, so the claim was never checked, while the refusal
    made a first run impossible for anyone without a role already created.
    `_effective_role` checks it instead, by asking CURRENT_ROLE().

    What this pins down is that validation no longer stops here: with no role
    anywhere, the run reaches the driver and is refused by it instead. The
    driver is stubbed so that holds whether or not `[warehouses]` is
    installed -- without the stub this test would pass in CI for the wrong
    reason and attempt a real connection on a developer's machine.
    """
    import types

    import pytest

    from semlayer.connectors.snowflake import SnowflakeSource
    from semlayer.errors import SourceError

    class _Refused(Exception):
        pass

    mod = types.ModuleType("snowflake")
    conn = types.ModuleType("snowflake.connector")
    errors = types.ModuleType("snowflake.connector.errors")
    errors.Error = _Refused

    def connect(**kw):
        assert "role" not in kw, "no role was set, so none may be sent"
        raise _Refused("incorrect username or password")

    conn.connect = connect
    conn.errors = errors
    mod.connector = conn
    for name, m in (("snowflake", mod), ("snowflake.connector", conn),
                    ("snowflake.connector.errors", errors)):
        monkeypatch.setitem(sys.modules, name, m)

    for var in ("SNOWFLAKE_READER_ROLE", "SNOWFLAKE_ROLE"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("SNOWFLAKE_ACCOUNT", "acct")
    monkeypatch.setenv("SNOWFLAKE_READER_USER", "u")
    monkeypatch.setenv("SNOWFLAKE_READER_PASSWORD", "p")

    with pytest.raises(SourceError) as e:
        SnowflakeSource.from_env(persona="reader")
    assert "refused the connection" in str(e.value), (
        "a missing role must no longer be refused before the driver is reached")
    assert "session role" not in str(e.value)


def test_init_snowflake_creates_a_user_that_can_actually_log_in():
    """A password user created by this script cannot connect at all.

    Snowflake enforces MFA on password sign-ins for users of the default
    (person) type, so `semlayer infer` was refused on its first connection
    with "390197 Multi-factor authentication is required" -- and there is
    nobody to approve a prompt for a service account. Measured on a current
    account, 2026-11-01.

    `init` renders a string, so what is pinned here is the string: a SERVICE
    user, a key, and no password anywhere in the script.
    """
    from semlayer.init_cmd import render
    sql = render("snowflake", database="proddb", warehouse_name="wh1")
    assert "TYPE = SERVICE" in sql
    assert "RSA_PUBLIC_KEY" in sql
    assert "PASSWORD" not in sql, "a password user is refused by MFA enforcement"
    # the key pair has to be makeable from the script alone
    assert "openssl genrsa 2048" in sql
    assert "pkcs8 -topk8" in sql
    assert "-pubout" in sql
    # and the environment has to name the key rather than a secret
    assert "SNOWFLAKE_READER_PRIVATE_KEY_PATH" in sql


def _run_discover(args, cwd, env=None):
    import os
    e = dict(os.environ)
    e.pop("SNOWFLAKE_ACCOUNT", None)
    e.update(env or {})
    return subprocess.run([sys.executable, "-m", "semlayer.cli", "discover", *args],
                          cwd=cwd, env=e, capture_output=True, text=True)


def test_discover_json_lists_a_duckdb_file_in_the_folder(tmp_path):
    """The connect screen's list. Shipped as an MCP tool and nothing else.

    `session.discover` has answered this since the MCP server shipped, so the
    extension's connect screen was built as a bare input box asking the user
    for a URI they had to already know -- and the gap was recorded as
    impossible ("no CLI verb does this") rather than as unbuilt.
    """
    import json
    (tmp_path / "warehouse.duckdb").write_bytes(b"")
    r = _run_discover(["--json"], tmp_path)
    assert r.returncode == 0, r.stderr
    found = json.loads(r.stdout)
    assert any(e["uri"] == "duckdb:warehouse.duckdb" for e in found), found
    for e in found:
        assert set(e) >= {"uri", "kind", "source", "supported", "note"}


def test_discover_finding_nothing_is_an_answer_not_a_failure(tmp_path):
    """Exit 0 with an empty list.

    A non-zero code here would make every caller treat "you have no warehouse
    configured" as a broken install, which is the opposite of what the screen
    needs to say.
    """
    import json
    r = _run_discover(["--json"], tmp_path)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout) == []

    human = _run_discover([], tmp_path)
    assert human.returncode == 0
    assert "No warehouse connections found" in human.stdout
    assert "semlayer demo" in human.stdout, "it must name a way forward"


def test_discover_marks_a_half_configured_connection_and_says_what_is_missing(tmp_path):
    """The row that earns the screen its place.

    An account set and no credentials is the normal half-configured state, and
    the note is the whole value: it names the variables to add.
    """
    r = _run_discover([], tmp_path, env={"SNOWFLAKE_ACCOUNT": "acme"})
    assert r.returncode == 0, r.stderr
    assert "!" in r.stdout
    assert "SNOWFLAKE_READER_USER" in r.stdout
    assert "cannot open yet" in r.stdout


def test_drift_json_is_json_even_when_nothing_drifted(tmp_path, capsys):
    """`--json` must never print prose.

    No drift is the commonest outcome, and it printed one sentence whether or
    not JSON was asked for, so every agent and CI step parsing this had to
    special-case it -- against a shape nobody had written down. Found by
    walking the extension end to end on a clean directory.
    """
    import json

    import duckdb

    from semlayer.cli import main
    from semlayer.pipeline import infer
    from semlayer.source import DuckDBSource

    db = tmp_path / "w.duckdb"
    con = duckdb.connect(str(db))
    con.execute("create table t (id integer primary key, n varchar)")
    con.execute("insert into t values (1, 'a')")
    doc = infer(DuckDBSource(con))
    con.close()

    layer = tmp_path / "w.yaml"
    layer.write_text(__import__("yaml").safe_dump(doc))
    capsys.readouterr()

    assert main(["drift", str(layer), f"duckdb:{db}", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["events"] == []
    # The empty answer carries every key the non-empty one does, so a consumer
    # written against one shape does not fall over on the other.
    assert set(payload) == {"events", "orphaned", "needs_inference", "affected",
                            "broken_cqs", "demoted", "retable"}

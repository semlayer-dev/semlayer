"""The semlayer MCP server as Glama hosts it, with two starter prompts.

    python examples/glama/server.py layer.yaml

Glama shows a server's prompts as buttons, and a visitor there arrives with a
layer already loaded and no question in mind. These two give them one click
that shows something. They live here and not in `semlayer mcp` because they
assume a layer is loaded at startup, which is true of a hosted demo and of
almost nobody else: a user on their own machine gets the `setup` prompt and
nothing they did not ask for.

Each prompt starts with tools that take no arguments, so the host can run it
without asking the visitor anything, and neither names the warehouse: the
layer file decides what this serves.
"""
from __future__ import annotations

import sys

from semlayer.mcp_server import build_server
from semlayer.session import Session

EXPLORE = """\
The user wants to see what this warehouse holds and what they can ask of it.

1. Call `status`. If no layer is loaded, say so, do what `next` says, and
   stop here.
2. Call `get_domains` and `get_metrics`. Neither takes an argument.
3. Say which warehouse this is, then give the domains in a line each and the
   metrics by name with what each one measures. Do not list every table.
4. Offer three questions this layer can answer, in the user's words and not
   in SQL, each built on a metric or a table you were just shown. Do not
   answer them until one is picked.

When they pick one, answer it the usual way: `context_for_question`, then
`check_sql`, then `run_sql`.
"""

AUDIT = """\
The user wants to know how far to trust this layer.

1. Call `status`. If no layer is loaded, say so, do what `next` says, and
   stop here.
2. Call `review_questions` and `review_decisions`, with no arguments.
3. Say how many claims are still open and, if `truncated` is set, that
   there are more than you were shown. Group the open ones by kind and put
   the ones with `gates_behaviour` set first: those change which rows or
   which table an answer uses. For each kind, give one or two claims and
   what the engine saw, in a sentence each.
4. Say what has been decided and by whom. A decision whose `signal` is
   `agent` has been confirmed by nobody: say so.

Report only. Do not record a verdict with `review_answer` unless the user
gives one, and never record one of your own.
"""


def build(layer_path: str):
    """The standard server over one layer file, with the two prompts added."""
    session = Session()
    session.load(layer_path)
    srv = build_server(session)

    @srv.prompt(name="explore",
                description="Show me what is in this warehouse and what I can ask")
    def explore() -> str:
        return EXPLORE

    @srv.prompt(name="audit",
                description="Show me what in this layer is uncertain or unconfirmed")
    def audit() -> str:
        return AUDIT

    return srv


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python examples/glama/server.py LAYER.yaml")
    build(sys.argv[1]).run()

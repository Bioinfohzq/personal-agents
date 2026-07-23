"""State definition for the lead agent graph."""

from __future__ import annotations

import operator
from typing import Annotated, Sequence, TypedDict

from langchain_core.messages import BaseMessage


class AgentState(TypedDict):
    """LangGraph state shared across agent and tool nodes.

    Attributes:
        messages: Conversation history, appended by nodes via operator.add.
        metadata: Extra context for tools / harness observability.
    """

    messages: Annotated[Sequence[BaseMessage], operator.add]
    metadata: Annotated[dict, operator.or_]

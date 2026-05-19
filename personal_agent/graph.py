from langgraph.graph import END, START, StateGraph

from personal_agent.nodes import call_model
from personal_agent.state import AgentState


def build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("call_model", call_model)
    builder.add_edge(START, "call_model")
    builder.add_edge("call_model", END)
    return builder.compile()


graph = build_graph()

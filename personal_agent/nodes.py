from langchain_openai import ChatOpenAI

from personal_agent.config import load_agent_settings
from personal_agent.state import AgentState


def call_model(state: AgentState) -> dict[str, object]:
    settings = load_agent_settings()
    model = ChatOpenAI(model=settings.model_name)
    response = model.invoke(state["messages"])
    return {"messages": [response]}

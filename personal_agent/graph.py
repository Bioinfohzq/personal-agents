from langchain.agents import create_agent

from personal_agent.config import load_agent_settings

SYSTEM_PROMPT = (
    "You are a helpful personal assistant. "
    "Keep responses concise and accurate."
)


def build_graph():
    settings = load_agent_settings()
    return create_agent(
        model=settings.model,
        system_prompt=SYSTEM_PROMPT,
    )


graph = build_graph()

from langchain.agents import create_agent

from lead_agent.model_config import load_model
from lead_agent.prompt import SYSTEM_PROMPT


def build_graph():
    return create_agent(
        model=load_model(),
        system_prompt=SYSTEM_PROMPT,
    )


graph = build_graph()

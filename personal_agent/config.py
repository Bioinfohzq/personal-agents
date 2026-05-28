from dataclasses import dataclass
from os import environ

from dotenv import load_dotenv


@dataclass(frozen=True)
class AgentSettings:
    model: str


def load_agent_settings() -> AgentSettings:
    load_dotenv()
    model_name = environ["MODEL_NAME"]
    if ":" in model_name:
        model = model_name
    else:
        model = f"openai:{model_name}"
    return AgentSettings(model=model)

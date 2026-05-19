from dataclasses import dataclass
from os import environ

from dotenv import load_dotenv


@dataclass(frozen=True)
class AgentSettings:
    model_name: str


def load_agent_settings() -> AgentSettings:
    load_dotenv()
    return AgentSettings(model_name=environ["MODEL_NAME"])

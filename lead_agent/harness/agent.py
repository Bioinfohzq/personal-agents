"""Graph builder / executor for the lead agent harness.

使用 LangChain ``langchain.agents.create_agent`` SDK 构造 agent，
保留 harness 配置、工具注册和状态定义作为统一扩展层。
"""

from __future__ import annotations

from langchain.agents import create_agent

from lead_agent.harness.config import HarnessConfig
from lead_agent.harness.model_config import load_model
from lead_agent.harness.prompt import SYSTEM_PROMPT
from lead_agent.tools.registry import get_tools


def build_graph(config: HarnessConfig | None = None):
    """使用 ``create_agent`` 构建 lead agent 可执行图。

    Args:
        config: Harness 运行时配置；None 时使用默认配置。

    Returns:
        已编译的 LangGraph 图，可直接被 langgraph.json 引用。
    """
    config = config or HarnessConfig()
    tools = get_tools(config)
    model = load_model()

    return create_agent(
        model=model,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
    )

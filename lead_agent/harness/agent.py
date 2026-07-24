"""Graph builder / executor for the lead agent harness.

使用 LangChain ``langchain.agents.create_agent`` SDK 构造 agent，
保留 harness 配置、工具注册和状态定义作为统一扩展层。
"""

from __future__ import annotations

from typing import Any

from langchain.agents import create_agent
from langchain_core.tools import BaseTool

from lead_agent.harness.config import HarnessConfig
from lead_agent.harness.model_config import load_model
from lead_agent.harness.prompts import SYSTEM_PROMPT
from lead_agent.tools.adapters.mcp import load_mcp_tools
from lead_agent.tools.builtin import get_builtin_tools
from lead_agent.tools.registry import get_registered_tools


def _load_tools(config: HarnessConfig) -> list[BaseTool]:
    """按优先级组合所有可用工具：手动注册 > 内置工具 > MCP 工具。

    手动注册表由 ``lead_agent.tools.registry`` 维护，适合测试或外部注入。
    MCP 工具当前为占位实现，开启 ``config.enable_mcp`` 后自动加载，
    待 ``lead_agent.tools.adapters.mcp`` 实现具体连接逻辑。
    """
    tools: list[BaseTool] = []

    # 1. 运行时手动注册的工具（测试/外部注入优先）
    tools.extend(get_registered_tools())

    # 2. 内置工具
    tools.extend(get_builtin_tools())

    # 3. MCP 外部工具（预留接入点）
    if config.enable_mcp:
        tools.extend(load_mcp_tools(config))

    return tools


def build_graph(config: HarnessConfig | None = None):
    """使用 ``create_agent`` 构建 lead agent 可执行图。

    Args:
        config: Harness 运行时配置；None 时使用默认配置。

    Returns:
        已编译的 LangGraph 图，可直接被 langgraph.json 引用。
    """
    config = config or HarnessConfig()
    tools = _load_tools(config)
    model = load_model()

    return create_agent(
        model=model,
        tools=tools,
        system_prompt=SYSTEM_PROMPT,
    )

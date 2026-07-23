"""Tool registry: 发现、加载并组合内置工具与外部适配器工具。"""

from __future__ import annotations

from langchain_core.tools import BaseTool

from lead_agent.harness.config import HarnessConfig
from lead_agent.tools.builtin import get_builtin_tools

# 运行时注册表，供外部或测试代码手动注入工具
_REGISTRY: list[BaseTool] = []


def register_tool(tool: BaseTool) -> BaseTool:
    """手动注册一个工具到运行时注册表。"""
    _REGISTRY.append(tool)
    return tool


def discover_builtin_tools() -> list[BaseTool]:
    """加载内置工具。新增内置工具时，在 tools/builtin/__init__.py 中维护。"""
    return get_builtin_tools()


def _load_mcp_tools(config: HarnessConfig) -> list[BaseTool]:
    """加载 MCP 工具；当前为占位实现。"""
    # TODO: 接入 lead_agent.tools.adapters.mcp.load_mcp_tools
    return []


def get_tools(config: HarnessConfig | None = None) -> list[BaseTool]:
    """聚合所有可用工具：手动注册 + 内置 + MCP（如启用）。"""
    config = config or HarnessConfig()
    tools: list[BaseTool] = []

    tools.extend(_REGISTRY)
    tools.extend(discover_builtin_tools())

    if config.enable_mcp:
        tools.extend(_load_mcp_tools(config))

    return tools

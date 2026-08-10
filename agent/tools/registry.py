"""Tool registry: 运行时手动注册表。

内置工具与 MCP 工具的聚合由 ``agent.harness.agent._load_tools`` 负责，
这里只保留手动注入能力，方便测试和外部扩展。
"""

from __future__ import annotations

from langchain_core.tools import BaseTool

# 运行时注册表，供外部或测试代码手动注入工具
_REGISTRY: list[BaseTool] = []


def register_tool(tool: BaseTool) -> BaseTool:
    """手动注册一个工具到运行时注册表。"""
    _REGISTRY.append(tool)
    return tool


def get_registered_tools() -> list[BaseTool]:
    """返回运行时手动注册的所有工具。"""
    return list(_REGISTRY)


def clear_registered_tools() -> None:
    """清空运行时注册表（主要用于测试）。"""
    _REGISTRY.clear()

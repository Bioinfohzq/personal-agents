"""MCP (Model Context Protocol) tool adapter.

TODO:
- 引入 mcp 客户端依赖（如官方 Python SDK 发布后可替换）。
- 实现 MCP server 连接、工具发现与生命周期管理。
- 将 MCP tool 定义转换为 langchain_core.tools.BaseTool 子类。
- 在 HarnessConfig 中配置 mcp_servers 后，通过 registry 加载。

当前仅保留接口占位，不影响主流程。
"""

from __future__ import annotations

from langchain_core.tools import BaseTool

from agent.harness.config import HarnessConfig


def load_mcp_tools(config: HarnessConfig) -> list[BaseTool]:
    """从 HarnessConfig.mcp_servers 加载 MCP 工具。"""
    if not config.enable_mcp or not config.mcp_servers:
        return []

    # TODO: implement MCP client connection and tool conversion
    return []

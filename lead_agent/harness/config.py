"""Harness-level configuration."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class HarnessConfig:
    """运行时配置，控制 agent 迭代、工具行为和外部适配器。"""

    # Agent 自我保护：防止无限 tool-call 循环
    max_iterations: int = 10

    # 单个工具调用超时（秒），None 表示不超时
    tool_timeout: float | None = 30.0

    # MCP 开关与服务器列表；目前仅预留结构，适配器待实现
    enable_mcp: bool = False
    mcp_servers: list[dict] = field(default_factory=list)

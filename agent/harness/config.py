"""Harness-level configuration."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class CheckpointBackend(str, Enum):
    """Checkpoint / 短期记忆存储后端。"""

    NONE = "none"          # 不配置代码层 checkpointer，由 langgraph dev 默认落盘
    MEMORY = "memory"      # 内存，重启丢失，仅测试
    SQLITE = "sqlite"      # 本地 SQLite 文件
    POSTGRES = "postgres"  # PostgreSQL（待接入）
    MONGODB = "mongodb"    # MongoDB（待接入）


@dataclass
class CheckpointConfig:
    """Checkpoint 后端配置。"""

    # 后端类型
    backend: CheckpointBackend = CheckpointBackend.NONE

    # 后端特定参数，例如 sqlite 的 conn_string、postgres 的连接串等
    config: dict[str, Any] = field(default_factory=dict)


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

    # Checkpoint / 短期记忆配置
    checkpoint: CheckpointConfig = field(default_factory=CheckpointConfig)

"""Checkpoint / short-term memory factory.

统一提供两种入口：
- ``generate_checkpointer``：async 上下文管理器，供 ``langgraph.json`` 的 ``checkpointer.path`` 使用。
- ``load_checkpointer``：同步包装，供代码层直接调用。

支持后端（由环境变量或 ``HarnessConfig`` 控制）：
- memory: 进程内内存，重启丢失，适合测试
- sqlite: 本地 SQLite 文件（默认）
- postgres: PostgreSQL（待接入真实连接池）
- mongodb: MongoDB（待接入真实客户端）
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from pathlib import Path
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import MemorySaver

from lead_agent.harness.config import CheckpointBackend, CheckpointConfig, HarnessConfig

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 配置解析
# ---------------------------------------------------------------------------

def _build_config_from_env() -> CheckpointConfig:
    """从环境变量构建 CheckpointConfig。"""
    backend = os.getenv("CHECKPOINT_BACKEND", CheckpointBackend.SQLITE.value)
    config: dict[str, Any] = {}

    if backend == CheckpointBackend.SQLITE.value:
        config["conn_string"] = os.getenv(
            "CHECKPOINT_SQLITE_PATH",
            "./.langgraph_api/checkpoints.sqlite",
        )
    elif backend == CheckpointBackend.POSTGRES.value:
        config["conn_string"] = os.getenv("CHECKPOINT_POSTGRES_URI", "")
    elif backend == CheckpointBackend.MONGODB.value:
        config["uri"] = os.getenv("CHECKPOINT_MONGODB_URI", "")

    return CheckpointConfig(backend=CheckpointBackend(backend), config=config)


# ---------------------------------------------------------------------------
# 后端创建（async，所有后端统一走这里）
# ---------------------------------------------------------------------------

@contextlib.asynccontextmanager
async def _create_checkpointer(
    backend: CheckpointBackend,
    backend_config: dict[str, Any],
):
    """根据 backend 类型创建并托管 checkpointer 生命周期。"""
    logger.info("Checkpointer backend: %s", backend.value)

    if backend == CheckpointBackend.MEMORY:
        logger.info("Checkpointer: using InMemorySaver (in-process, not persistent)")
        yield MemorySaver()
        return

    if backend == CheckpointBackend.SQLITE:
        try:
            from langgraph.checkpoint.sqlite import SqliteSaver
        except ImportError as exc:
            raise ImportError(
                "使用 sqlite checkpoint 需要安装 langgraph-checkpoint-sqlite"
            ) from exc

        conn_string = backend_config.get("conn_string") or "./.langgraph_api/checkpoints.sqlite"
        Path(conn_string).parent.mkdir(parents=True, exist_ok=True)

        with SqliteSaver.from_conn_string(conn_string) as saver:
            saver.setup()
            logger.info("Checkpointer: using SqliteSaver (%s)", conn_string)
            yield saver
        return

    if backend == CheckpointBackend.POSTGRES:
        try:
            from langgraph.checkpoint.postgres import PostgresSaver
        except ImportError as exc:
            raise ImportError(
                "使用 postgres checkpoint 需要安装 langgraph-checkpoint-postgres"
            ) from exc

        conn_string = backend_config.get("conn_string", "")
        if not conn_string:
            raise ValueError("postgres checkpoint 需要配置 conn_string / CHECKPOINT_POSTGRES_URI")

        # TODO: 建立异步连接池、调用 await saver.setup()
        saver = PostgresSaver.from_conn_string(conn_string)
        logger.info("Checkpointer: using PostgresSaver")
        yield saver
        return

    if backend == CheckpointBackend.MONGODB:
        try:
            from langgraph.checkpoint.mongodb import MongoDBSaver
        except ImportError as exc:
            raise ImportError(
                "使用 mongodb checkpoint 需要安装 langgraph-checkpoint-mongodb"
            ) from exc

        uri = backend_config.get("uri", "")
        if not uri:
            raise ValueError("mongodb checkpoint 需要配置 uri / CHECKPOINT_MONGODB_URI")

        # TODO: 创建 MongoClient、选择 db
        saver = MongoDBSaver({"uri": uri})
        logger.info("Checkpointer: using MongoDBSaver")
        yield saver
        return

    raise ValueError(f"未知 checkpoint backend: {backend}")


# ---------------------------------------------------------------------------
# 对外入口
# ---------------------------------------------------------------------------

@contextlib.asynccontextmanager
async def generate_checkpointer():
    """LangGraph Agent Server 入口。

    ``langgraph.json`` 中配置::

        "checkpointer": {
          "path": "./lead_agent/harness/checkpointer.py:generate_checkpointer"
        }
    """
    cfg = _build_config_from_env()
    async with _create_checkpointer(cfg.backend, cfg.config) as saver:
        yield saver


def load_checkpointer(
    config: HarnessConfig | None = None,
) -> BaseCheckpointSaver | None:
    """代码层同步入口。

    根据 ``HarnessConfig`` 创建 checkpointer 实例；
    backend 为 ``none`` 时返回 None，让上层使用默认落盘行为。
    """
    config = config or HarnessConfig()
    backend = config.checkpoint.backend
    backend_config = config.checkpoint.config

    if backend == CheckpointBackend.NONE:
        return None

    # 统一走 async 创建逻辑，同步场景用 asyncio.run 桥接
    return asyncio.run(_load_checkpointer_async(backend, backend_config))


async def _load_checkpointer_async(
    backend: CheckpointBackend,
    backend_config: dict[str, Any],
) -> BaseCheckpointSaver:
    async with _create_checkpointer(backend, backend_config) as saver:
        return saver

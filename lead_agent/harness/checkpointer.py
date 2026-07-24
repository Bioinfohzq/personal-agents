"""Checkpoint / short-term memory factory.

对外入口：
- ``generate_checkpointer``：async 上下文管理器，供 ``langgraph.json`` 的 ``checkpointer.path`` 使用。

支持后端（由环境变量控制）：
- memory: 进程内内存，重启丢失，适合测试
- sqlite: 本地 SQLite 文件（默认）
- postgres: PostgreSQL（待接入真实连接池）
- mongodb: MongoDB（待接入真实客户端）
"""

from __future__ import annotations

import contextlib
import logging
import os
from pathlib import Path
from typing import Any

from lead_agent.harness.config import CheckpointBackend, CheckpointConfig

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
    """根据 backend 类型创建并托管 checkpointer 生命周期。

    这是一个 async 上下文管理器，负责：
    1. 按 backend 选择对应的 LangGraph checkpointer 实现；
    2. 建立连接 / 初始化文件 / 创建表结构；
    3. 在作用域结束时释放连接。

    Args:
        backend: 存储后端类型（memory / sqlite / postgres / mongodb）。
        backend_config: 该后端所需的连接配置，例如 sqlite 的文件路径、
            postgres 的连接串、mongodb 的 uri。
    """
    logger.info("Checkpointer backend: %s", backend.value)

    # ------------------------------------------------------------------
    # memory：进程内内存，重启后数据丢失；适合本地快速调试，无需任何配置。
    # ------------------------------------------------------------------
    if backend == CheckpointBackend.MEMORY:
        try:
            from langgraph.checkpoint.memory import InMemorySaver
        except ImportError as exc:
            raise ImportError(
                "使用 memory checkpoint 需要安装 langgraph-checkpoint"
            ) from exc

        logger.info("Checkpointer: using InMemorySaver (in-process, not persistent)")
        yield InMemorySaver()
        return

    # ------------------------------------------------------------------
    # sqlite：本地文件数据库（默认后端），适合本地开发和单机 demo。
    # 只需要一个文件路径，代码会自动创建文件和表结构，无需单独启动数据库服务。
    # 配置项：backend_config["conn_string"] 或环境变量 CHECKPOINT_SQLITE_PATH
    # ------------------------------------------------------------------
    if backend == CheckpointBackend.SQLITE:
        try:
            from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        except ImportError as exc:
            raise ImportError(
                "使用 sqlite checkpoint 需要安装 langgraph-checkpoint-sqlite 和 aiosqlite"
            ) from exc

        conn_string = backend_config.get("conn_string") or "./.langgraph_api/checkpoints.sqlite"
        Path(conn_string).parent.mkdir(parents=True, exist_ok=True)

        async with AsyncSqliteSaver.from_conn_string(conn_string) as saver:
            await saver.setup()
            logger.info("Checkpointer: using AsyncSqliteSaver (%s)", conn_string)
            yield saver
        return

    # ------------------------------------------------------------------
    # postgres：生产级持久化，需要可访问的 PostgreSQL 服务。
    # 配置项：backend_config["conn_string"] 或环境变量 CHECKPOINT_POSTGRES_URI
    # 数据库需要提前创建好（如 CREATE DATABASE langgraph;），表结构由 SDK 自动创建。
    # TODO: 目前只做了导入和参数校验，尚未接入真实异步连接池。
    # ------------------------------------------------------------------
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

        saver = PostgresSaver.from_conn_string(conn_string)
        logger.info("Checkpointer: using PostgresSaver")
        yield saver
        return

    # ------------------------------------------------------------------
    # mongodb：另一种生产级持久化，需要可访问的 MongoDB 服务。
    # 配置项：backend_config["uri"] 或环境变量 CHECKPOINT_MONGODB_URI
    # TODO: 目前只做了导入和参数校验，尚未接入真实 MongoClient。
    # ------------------------------------------------------------------
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

    LangGraph Server 启动时会调用本函数，按环境变量选择 backend 并创建
    checkpointer，然后在 Server 生命周期内托管该实例。
    """
    cfg = _build_config_from_env()
    async with _create_checkpointer(cfg.backend, cfg.config) as saver:
        yield saver

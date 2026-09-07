"""核心记忆预注入 Middleware - B7 长期记忆 A+B 混合方案的 A 部分

在每次 Agent 执行开始前(before_agent),从后端拉取用户 importance≥4 的核心记忆,
作为 SystemMessage 注入到 messages 最前面(放在原始 SYSTEM_PROMPT 之后)。
非核心记忆由AI在对话过程中通过 recall_memory 工具按需检索(B 部分)。

为避免每次对话都重复注入(多轮对话中只注入一次),通过检查 messages 中
是否已存在带有 __CORE_MEMORY_MARKER__ 标识的 SystemMessage 来去重。
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import SystemMessage
from langchain.agents.middleware import AgentMiddleware

from agent.tools.builtin.memory import fetch_core_memories

logger = logging.getLogger(__name__)

# 标记:注入的SystemMessage携带此id,避免多轮对话中重复注入
_CORE_MEMORY_TAG = "__core_memory_injected__"

# 主题中文标签(与 memory.py 保持一致)
_TOPIC_LABELS = {
    "personal_fact": "个人事实",
    "tech_preference": "技术偏好",
    "project_convention": "项目约定",
    "lesson_learned": "踩坑教训",
    "communication_style": "沟通偏好",
}


class CoreMemoryMiddleware(AgentMiddleware):
    """在对话开始时预注入核心记忆的中间件"""

    def __init__(self, min_importance: int = 4):
        self.min_importance = min_importance

    @property
    def name(self) -> str:
        return "CoreMemoryMiddleware"

    def _already_injected(self, messages: list[Any]) -> bool:
        """检查是否已注入过核心记忆(避免多轮对话重复注入)"""
        for m in messages:
            if isinstance(m, SystemMessage):
                content = m.content if isinstance(m.content, str) else ""
                if _CORE_MEMORY_TAG in content:
                    return True
                # 兼容旧格式:如果文本里已经有"## 关于用户的已知信息"标题,也算注入过
                if "## 关于用户的已知信息" in content and "核心记忆" in content:
                    return True
        return False

    def _format_memories(self, memories: list[dict]) -> str:
        """将记忆列表格式化为 system prompt 段落"""
        if not memories:
            return ""
        lines = [
            f"<!-- {_CORE_MEMORY_TAG} -->",
            "## 关于用户的已知信息(核心记忆)",
            "以下是你之前已经记住的关于该用户的长期信息,回答问题时请优先参考,但不要主动向用户提及这些记忆的存在:",
        ]
        # 按topic分组展示
        grouped: dict[str, list[dict]] = {}
        for m in memories:
            topic = m.get("topic", "other")
            grouped.setdefault(topic, []).append(m)
        for topic, items in grouped.items():
            label = _TOPIC_LABELS.get(topic, topic)
            for m in items:
                title = m.get("title", "")
                content = m.get("content", "").strip()
                if title and title != content:
                    lines.append(f"- [{label}] {title}: {content}")
                else:
                    lines.append(f"- [{label}] {content}")
        return "\n".join(lines)

    def before_agent(self, state: Any, runtime: Any) -> dict[str, Any] | None:
        messages = list(state.get("messages", []) or [])
        if self._already_injected(messages):
            return None
        try:
            memories = fetch_core_memories(min_importance=self.min_importance)
        except Exception as e:
            logger.warning("core memory fetch failed, skipping injection: %s", e)
            return None
        if not memories:
            return None
        text = self._format_memories(memories)
        if not text:
            return None
        # 在现有SystemMessage之后、第一条HumanMessage之前插入核心记忆SystemMessage
        # LangChain create_agent 会把原始 SYSTEM_PROMPT 作为第一条SystemMessage
        insert_at = 0
        for i, m in enumerate(messages):
            from langchain_core.messages import SystemMessage as SM
            if isinstance(m, SM):
                insert_at = i + 1
            else:
                break
        new_messages = list(messages)
        new_messages.insert(insert_at, SystemMessage(content=text))
        return {"messages": new_messages}

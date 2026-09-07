"""记忆相关工具 - B7 长期记忆自动归档

提供三个工具:
- save_memory: 保存一条记忆(自动去重合并)
- recall_memory: 语义检索相关记忆
- core_memories: 获取核心记忆(对话启动时预注入,非AI主动调用)
"""

from __future__ import annotations

import json
import os
from typing import Optional

import httpx
from langchain_core.tools import tool

_BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:18080").rstrip("/")
_INTERNAL_KEY = os.getenv("INTERNAL_API_KEY", "")
_USER_ID = int(os.getenv("BACKEND_USER_ID", "1"))
_TIMEOUT = 10.0

# 记忆主题分类白名单(与后端 Topic* 常量一致)
_VALID_TOPICS = {
    "personal_fact",        # 个人事实(设备、角色、环境)
    "tech_preference",      # 技术偏好(语言、框架、工具)
    "project_convention",   # 项目约定(规范、配置)
    "lesson_learned",       # 踩坑教训(bug和解决方案)
    "communication_style",  # 沟通偏好(语言、风格)
}

# 主题中文标签(用于AI返回时展示)
_TOPIC_LABELS = {
    "personal_fact": "个人事实",
    "tech_preference": "技术偏好",
    "project_convention": "项目约定",
    "lesson_learned": "踩坑教训",
    "communication_style": "沟通偏好",
}


def _headers() -> dict:
    return {
        "X-Internal-Key": _INTERNAL_KEY,
        "Content-Type": "application/json",
    }


@tool
def save_memory(
    topic: str,
    content: str,
    title: Optional[str] = None,
    importance: Optional[int] = None,
) -> str:
    """将一条用户相关的信息保存到长期记忆库(自动去重合并:同主题高相似度的记忆会合并为一条)。

    何时调用:
    - 用户明确说"记住xxx""帮我记一下xxx""以后记住xxx"
    - 对话中出现了关于用户的长期事实/技术偏好/项目约定/踩坑教训/沟通风格,
      且你已经向用户确认并获得同意(或用户已经明确表达了该偏好)
    - 你在回答完一个踩坑问题后,可以建议"我把这个教训存到记忆库,以后遇到类似问题直接参考"

    参数:
        topic: 主题分类,必须是以下之一:
            - "personal_fact": 个人事实(使用的设备、角色、开发环境等)
            - "tech_preference": 技术偏好(喜欢/不喜欢的语言、框架、工具、包管理器、代码风格)
            - "project_convention": 某个具体项目的约定、规范、配置规则(如"personal-agents项目SQL占位符统一用?")
            - "lesson_learned": 踩坑教训(遇到的bug、根因、解决方案)
            - "communication_style": 用户的沟通偏好(喜欢简洁/详细回答、中文/英文、是否需要举例)
        content: 记忆内容,要求清晰简洁的陈述句,避免模糊描述
        title: 可选简短标题,不填时自动从content首行截取
        importance: 重要度 1-5,默认为3;4-5为"核心记忆",会在每次对话开始时预注入

    返回:
        保存结果(新建或合并)
    """
    topic = (topic or "").strip()
    content = (content or "").strip()
    if not content:
        return "保存失败:content不能为空"
    if topic not in _VALID_TOPICS:
        return f"保存失败:topic必须是 {sorted(_VALID_TOPICS)} 之一"
    if importance is None:
        importance = 3
    if importance < 1 or importance > 5:
        return "保存失败:importance必须在1-5之间"

    payload: dict = {
        "topic": topic,
        "content": content,
        "importance": importance,
    }
    if title:
        payload["title"] = title.strip()

    url = f"{_BACKEND_URL}/api/v1/internal/memories/save?user_id={_USER_ID}"
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.post(url, headers=_headers(), json=payload)
            if resp.status_code != 200:
                return f"保存失败(HTTP {resp.status_code}): {resp.text[:300]}"
            data = resp.json()
            mid = data.get("id")
            created = data.get("created", True)
            label = _TOPIC_LABELS.get(topic, topic)
            action = "新建记忆" if created else "合并到已有记忆"
            return f"{action}成功(#{mid}, 分类:{label})"
    except httpx.HTTPError as e:
        return f"保存失败:无法连接后端({e})"
    except (json.JSONDecodeError, KeyError) as e:
        return f"保存失败:响应解析错误({e})"


@tool
def recall_memory(query: str, limit: Optional[int] = None) -> str:
    """语义检索长期记忆,根据query从记忆库中找到最相关的记忆条目。

    何时调用:
    - 用户的问题可能涉及之前你已经记住的用户偏好/项目约定/踩坑教训
    - 你需要了解"用户之前怎么说的""这个项目有什么约定"等
    - 注意:核心记忆(importance≥4)在对话开始时已经自动注入到system prompt,
      无需再通过本工具重复获取;本工具用于按需检索非核心但相关的记忆

    参数:
        query: 检索关键词/问题(自然语言即可,会转向量做语义匹配)
        limit: 返回条数,默认5,最大20

    返回:
        格式化的相关记忆列表;无相关记忆时返回"未找到相关记忆"
    """
    query = (query or "").strip()
    if not query:
        return "检索失败:query不能为空"
    n = limit if (limit is not None and 0 < limit <= 20) else 5

    url = f"{_BACKEND_URL}/api/v1/internal/memories/recall"
    params = {"q": query, "user_id": _USER_ID, "limit": n}
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.get(url, headers=_headers(), params=params)
            if resp.status_code != 200:
                return f"检索失败(HTTP {resp.status_code}): {resp.text[:300]}"
            data = resp.json()
            results = data.get("results", [])
            if not results:
                return "未找到相关记忆"
            lines = [f"找到 {len(results)} 条相关记忆:"]
            for r in results:
                mid = r.get("id")
                topic = r.get("topic", "")
                title = r.get("title", "")
                content = r.get("content", "")
                sim = r.get("similarity", 0)
                label = _TOPIC_LABELS.get(topic, topic)
                lines.append(f"\n[#{mid}][{label}] {title} (相关度:{sim:.2f})")
                lines.append(content)
            return "\n".join(lines)
    except httpx.HTTPError as e:
        return f"检索失败:无法连接后端({e})"
    except (json.JSONDecodeError, KeyError) as e:
        return f"检索失败:响应解析错误({e})"


def fetch_core_memories(min_importance: int = 4) -> list[dict]:
    """非工具函数:供agent启动时拉取核心记忆(直接返回结构化数据,不格式化文本)"""
    url = f"{_BACKEND_URL}/api/v1/internal/memories/core"
    params = {"user_id": _USER_ID, "min_importance": min_importance}
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.get(url, headers=_headers(), params=params)
            if resp.status_code != 200:
                return []
            data = resp.json()
            return data.get("memories", []) or []
    except Exception:
        return []

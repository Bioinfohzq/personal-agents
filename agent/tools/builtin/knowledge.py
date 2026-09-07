"""Knowledge base search built-in tool.

通过后端 /api/v1/internal/search 接口检索用户知识库（知识条目/长期记忆/对话片段），
返回语义最相关的内容，供 AI 回答时参考引用。
"""

from __future__ import annotations

import os
from typing import Optional

import httpx
from langchain_core.tools import tool


_BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8080").rstrip("/")
_INTERNAL_KEY = os.environ.get("INTERNAL_API_KEY", "5dfc305b3e8387a36618997357b7bc26e82ddf193bd7a20a8b7a5fd597c4ac8a")
_USER_ID = os.environ.get("BACKEND_USER_ID", "1")
_TIMEOUT = 15.0  # 秒


@tool
def search_knowledge_base(query: str, limit: Optional[int] = None) -> str:
    """在用户的个人知识库中搜索与 query 语义相关的内容。

    当用户的问题可能涉及用户之前记录的笔记、项目方案、技术总结、踩坑经验、
    个人偏好或项目约定等个人信息时，应调用此工具检索，然后基于检索结果回答，
    回答时引用来源标题。

    通用技术问题、代码编写、数学计算、闲聊等不需要调用。

    Args:
        query: 搜索关键词或问题描述，尽量简洁明确。
        limit: 返回结果数量上限，默认 5，最大 10。
    """
    if limit is None:
        limit = 5
    limit = max(1, min(limit, 10))

    url = f"{_BACKEND_URL}/api/v1/internal/search"
    params = {"q": query, "user_id": _USER_ID, "limit": limit}
    headers = {"X-Internal-Key": _INTERNAL_KEY}

    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.get(url, params=params, headers=headers)
    except httpx.HTTPError as e:
        return f"[知识库检索失败] 无法连接后端服务({url}): {e}"

    if resp.status_code != 200:
        return f"[知识库检索失败] 后端返回 HTTP {resp.status_code}: {resp.text[:300]}"

    try:
        data = resp.json()
    except ValueError:
        return f"[知识库检索失败] 后端返回非 JSON 响应: {resp.text[:300]}"

    results = data.get("results") or []
    if not results:
        return "(知识库中未找到相关内容)"

    lines: list[str] = []
    for i, r in enumerate(results, 1):
        rtype = r.get("type", "unknown")
        title = r.get("title") or "(无标题)"
        content = (r.get("content") or "").strip()
        score = r.get("similarity", 0)
        type_label = {"knowledge": "知识条目", "memory": "长期记忆", "message": "对话片段"}.get(rtype, rtype)
        lines.append(
            f"[{i}] [{type_label}] {title} (相似度 {score:.2f})\n{content}"
        )
    return "检索到以下相关内容:\n\n" + "\n\n".join(lines)

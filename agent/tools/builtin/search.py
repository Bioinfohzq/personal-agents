"""Web search built-in tool."""

from __future__ import annotations

from langchain_core.tools import tool


@tool
def web_search_tool(query: str, top_k: int = 5) -> str:
    """在网页上搜索给定 query 并返回摘要结果。

    Args:
        query: 搜索关键词。
        top_k: 返回结果数量上限。
    """
    # TODO: 接入真实搜索引擎 API（DuckDuckGo / SearXNG / Bing / 自定义）。
    # 当前仅保留工具签名和结构，避免 LLM 误用可返回明确提示。
    return (
        f"[TODO] web_search_tool 尚未接入真实搜索引擎。\n"
        f"query={query!r}, top_k={top_k}\n"
        f"请实现 lead_agent/tools/builtin/search.py 中的调用逻辑。"
    )

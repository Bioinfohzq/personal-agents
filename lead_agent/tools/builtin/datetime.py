"""Date/time built-in tool."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from langchain_core.tools import tool


@tool
def current_datetime_tool(timezone: str = "Asia/Shanghai") -> str:
    """获取当前日期和时间。

    Args:
        timezone: IANA 时区名称，例如 "Asia/Shanghai"、"UTC"。
    """
    tz = ZoneInfo(timezone)
    return datetime.now(tz).isoformat()

"""Built-in tools shipped with the lead agent."""

from lead_agent.tools.builtin.calculator import calculator_tool
from lead_agent.tools.builtin.datetime import current_datetime_tool
from lead_agent.tools.builtin.search import web_search_tool


def get_builtin_tools() -> list:
    """返回所有内置工具实例。"""
    return [
        current_datetime_tool,
        calculator_tool,
        web_search_tool,
    ]

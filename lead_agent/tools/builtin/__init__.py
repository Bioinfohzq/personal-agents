"""Built-in tools shipped with the lead agent."""

from lead_agent.tools.builtin.calculator import calculator_tool
from lead_agent.tools.builtin.datetime import current_datetime_tool
from lead_agent.tools.builtin.filesystem import (
    disk_usage_tool,
    file_permissions_tool,
    scan_directory_tool,
)
from lead_agent.tools.builtin.search import web_search_tool
from lead_agent.tools.builtin.shell import shell_tool


def get_builtin_tools() -> list:
    """返回所有内置工具实例。"""
    return [
        current_datetime_tool,
        calculator_tool,
        web_search_tool,
        # 系统操作工具: 仅 macOS/Linux 可用
        shell_tool,            # 执行终端命令
        scan_directory_tool,   # 扫描目录结构
        disk_usage_tool,       # 分析磁盘占用
        file_permissions_tool, # 查看文件权限
    ]

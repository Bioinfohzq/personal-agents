"""Built-in tools shipped with the lead agent."""

from agent.tools.builtin.aurixm import (
    a11y_input_key,
    a11y_input_text,
    a11y_scroll,
    a11y_screenshot,
    a11y_tap_text,
    a11y_tap_xy,
    a11y_ui_dump,
    a11y_wait_appear,
)
from agent.tools.builtin.calculator import calculator_tool
from agent.tools.builtin.datetime import current_datetime_tool
from agent.tools.builtin.filesystem import (
    disk_usage_tool,
    file_permissions_tool,
    scan_directory_tool,
)
from agent.tools.builtin.search import web_search_tool
from agent.tools.builtin.shell import shell_tool


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
        # Android 设备操作工具 (aurixm-app IPC)
        a11y_screenshot,       # 截屏
        a11y_ui_dump,          # 导出 UI 树
        a11y_tap_text,         # 点击文本元素
        a11y_tap_xy,           # 点击坐标
        a11y_input_text,       # 输入文本
        a11y_input_key,        # 模拟按键
        a11y_scroll,           # 滚动页面
        a11y_wait_appear,      # 等待元素出现
    ]

"""文件系统扫描工具。

让智能体扫描指定目录,获取子目录列表、权限信息、存储占用等。
用于辅助用户分析磁盘占用、清理无用缓存。
"""

from __future__ import annotations

import os
import platform
import stat
import subprocess
from pathlib import Path

from langchain_core.tools import tool


@tool
def scan_directory_tool(path: str, max_depth: int = 1) -> str:
    """扫描指定目录,返回子目录和文件的权限、大小信息。

    仅支持 macOS / Linux 系统。

    Args:
        path: 要扫描的目录路径,例如 "/Users/username/Downloads" 或 "~/.cache"。
        max_depth: 扫描深度,默认 1(只扫描直接子项)。最大 3 层防止过慢。

    Returns:
        格式化的目录扫描结果,包含每个子项的名称、类型、权限、大小。
    """
    if platform.system() == "Windows":
        return "[ERROR] scan_directory_tool 不支持 Windows 系统"

    # 展开 ~ 为 home 目录
    path = os.path.expanduser(path)
    max_depth = min(max_depth, 3)  # 限制最大深度

    if not os.path.exists(path):
        return f"[ERROR] 路径不存在: {path}"

    if not os.path.isdir(path):
        return f"[ERROR] 不是目录: {path}"

    lines = [f"扫描目录: {path}"]

    try:
        _scan_recursive(path, max_depth, 0, lines, prefix="")
    except PermissionError:
        lines.append("[权限不足] 无法读取该目录")
    except Exception as exc:
        lines.append(f"[ERROR] 扫描失败: {exc}")

    return "\n".join(lines)


@tool
def disk_usage_tool(path: str = "~") -> str:
    """分析指定目录下各子目录的磁盘占用情况,按大小排序。

    仅支持 macOS / Linux 系统。用于定位大文件/大目录,方便清理。

    Args:
        path: 要分析的目录路径,默认为用户 home 目录。

    Returns:
        按大小降序排列的子目录占用列表(人类可读格式)。
    """
    if platform.system() == "Windows":
        return "[ERROR] disk_usage_tool 不支持 Windows 系统"

    path = os.path.expanduser(path)

    if not os.path.isdir(path):
        return f"[ERROR] 目录不存在: {path}"

    try:
        # 用 du 命令快速计算各子目录大小
        # -sh: 人类可读格式 + 只显示总计
        # -d 1: 深度 1
        result = subprocess.run(
            ["du", "-sh", os.path.join(path, "*")],
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0 and not result.stdout:
            return f"[ERROR] du 命令执行失败: {result.stderr}"

        # du 输出格式: "大小\t路径",按大小排序(du 已按路径字母序输出,需要手动排序)
        lines = result.stdout.strip().split("\n") if result.stdout.strip() else []
        # 直接返回 du 的输出,已经够直观
        formatted_lines = [f"磁盘占用分析: {path}", "=" * 50]
        formatted_lines.extend(lines)
        return "\n".join(formatted_lines)

    except subprocess.TimeoutExpired:
        return f"[ERROR] 分析超时,目录可能过大: {path}"
    except Exception as exc:
        return f"[ERROR] 分析失败: {exc}"


@tool
def file_permissions_tool(path: str) -> str:
    """查看指定文件或目录的详细权限信息。

    仅支持 macOS / Linux 系统。

    Args:
        path: 文件或目录路径。

    Returns:
        权限字符串、所有者、所属组、文件类型等信息。
    """
    if platform.system() == "Windows":
        return "[ERROR] file_permissions_tool 不支持 Windows 系统"

    path = os.path.expanduser(path)

    if not os.path.exists(path):
        return f"[ERROR] 路径不存在: {path}"

    try:
        # 获取文件状态
        st = os.stat(path)

        # 解析权限位
        mode = stat.filemode(st.st_mode)

        # 判断文件类型
        if stat.S_ISDIR(st.st_mode):
            file_type = "目录"
        elif stat.S_ISLNK(st.st_mode):
            file_type = "符号链接"
        elif stat.S_ISREG(st.st_mode):
            file_type = "普通文件"
        else:
            file_type = "其他"

        # 获取所有者和组名
        import pwd
        import grp
        owner = pwd.getpwuid(st.st_uid).pw_name
        group = grp.getgrgid(st.st_gid).gr_name

        # 文件大小(人类可读)
        size = _human_readable_size(st.st_size)

        lines = [
            f"路径: {path}",
            f"类型: {file_type}",
            f"权限: {mode}",
            f"所有者: {owner}",
            f"所属组: {group}",
            f"大小: {size}",
        ]

        # 如果是符号链接,显示目标
        if os.path.islink(path):
            target = os.readlink(path)
            lines.append(f"链接目标: {target}")

        return "\n".join(lines)

    except PermissionError:
        return f"[权限不足] 无法读取: {path}"
    except Exception as exc:
        return f"[ERROR] 获取权限失败: {exc}"


# --- 内部辅助函数 ---

def _scan_recursive(
    path: str,
    max_depth: int,
    current_depth: int,
    lines: list[str],
    prefix: str,
) -> None:
    """递归扫描目录,将结果追加到 lines 列表。"""
    if current_depth >= max_depth:
        return

    try:
        entries = sorted(os.listdir(path))
    except PermissionError:
        lines.append(f"{prefix}[权限不足]")
        return

    for entry in entries:
        full_path = os.path.join(path, entry)
        try:
            st = os.stat(full_path)
            mode = stat.filemode(st.st_mode)
            is_dir = stat.S_ISDIR(st.st_mode)
            size = _human_readable_size(st.st_size) if not is_dir else "-"
            type_icon = "📁" if is_dir else "📄"
            lines.append(f"{prefix}{type_icon} {entry}  [{mode}]  {size}")
        except PermissionError:
            lines.append(f"{prefix}🔒 {entry}  [权限不足]")
        except OSError:
            lines.append(f"{prefix}⚠️ {entry}  [读取失败]")


def _human_readable_size(size: int) -> str:
    """将字节数转为人类可读格式。"""
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"

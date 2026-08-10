"""Shell 命令执行工具。

让智能体在用户的 Mac/Linux 系统上执行终端命令。
安全考量:
  1. 设置超时防止长时间阻塞
  2. 返回 stdout / stderr / exit_code 三部分信息
  3. 不做命令过滤(用户自行承担风险,建议后续加白名单或确认机制)
"""

from __future__ import annotations

import asyncio
import shutil
import platform

from langchain_core.tools import tool


@tool
def shell_tool(command: str, timeout: int = 30) -> str:
    """在用户终端执行 shell 命令并返回输出结果。

    仅支持 macOS / Linux 系统,Windows 不可用。
    命令在用户 home 目录下执行,使用系统默认 shell (/bin/zsh 或 /bin/bash)。

    Args:
        command: 要执行的终端命令,例如 "ls -la ~/Downloads" 或 "du -sh /Applications/*"。
        timeout: 命令超时时间(秒),默认 30 秒。超时后命令会被终止。

    Returns:
        包含 stdout、stderr 和 exit_code 的格式化字符串。
    """
    # Windows 系统不支持此工具
    if platform.system() == "Windows":
        return "[ERROR] shell_tool 不支持 Windows 系统"

    # 选择系统 shell: macOS 默认 zsh, Linux 通常有 bash
    shell_path = shutil.which("zsh") or shutil.which("bash") or "/bin/sh"

    try:
        # asyncio.create_subprocess_exec 不支持管道等 shell 语法,
        # 所以用 subprocess 通过 shell=True 执行(需要传入字符串命令)
        import subprocess

        result = subprocess.run(
            command,
            shell=True,
            executable=shell_path,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        # 拼装输出结果
        output_parts = []
        output_parts.append(f"[exit_code] {result.returncode}")

        if result.stdout:
            output_parts.append(f"[stdout]\n{result.stdout.strip()}")
        else:
            output_parts.append("[stdout] (空)")

        if result.stderr:
            output_parts.append(f"[stderr]\n{result.stderr.strip()}")

        return "\n".join(output_parts)

    except subprocess.TimeoutExpired:
        return f"[ERROR] 命令执行超时 ({timeout}秒),命令已被终止:\n{command}"
    except Exception as exc:
        return f"[ERROR] 命令执行失败: {exc}"

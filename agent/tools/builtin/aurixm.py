"""Aurixm Android 无障碍操作工具。

通过 HTTP 调用手机端 aurixm-app 的 IPC 接口 (POST /a11y)，
让智能体操控 Android 设备（点击、输入、截图、滚动等）。

连接方式：
  - USB 模式: 先 adb forward tcp:<port> tcp:<port>，host 填 127.0.0.1
  - WiFi 模式: 手机和电脑同一局域网，host 填手机 IP，不需要 adb

配置项（.env）:
  AURIXM_IPC_HOST=127.0.0.1
  AURIXM_IPC_PORT=8080
  AURIXM_IPC_TOKEN=   # 可选，手机端没配 token 就留空
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from langchain_core.tools import tool
from dotenv import load_dotenv

load_dotenv()


def _ipc_config() -> tuple[str, str]:
    """从环境变量读取 IPC 地址和 token。"""
    host = os.getenv("AURIXM_IPC_HOST", "127.0.0.1").strip()
    port = os.getenv("AURIXM_IPC_PORT", "8080").strip()
    token = os.getenv("AURIXM_IPC_TOKEN", "").strip()
    base_url = f"http://{host}:{port}"
    return base_url, token


def _ipc_call(argv: list[str], timeout: float = 30.0) -> str:
    """向手机 IPC 服务发送命令并返回结果。

    Args:
        argv: CLI 风格参数列表，如 ["android-a11y-cli", "tap", "xy", "500", "1200"]
        timeout: HTTP 请求超时（秒）

    Returns:
        手机端返回的 JSON 字符串，或错误信息。
    """
    base_url, token = _ipc_config()
    url = f"{base_url}/a11y"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    payload: dict[str, Any] = {"argv": argv, "caller": "lead-agent"}

    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=timeout)
        return resp.text
    except httpx.ConnectError:
        return json.dumps({
            "ok": False,
            "error": f"无法连接到手机 IPC 服务 ({url})，请确认 adb forward 已执行或手机 WiFi 可达",
        }, ensure_ascii=False)
    except httpx.TimeoutException:
        return json.dumps({
            "ok": False,
            "error": f"手机 IPC 请求超时 ({timeout}s)",
        }, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({
            "ok": False,
            "error": f"IPC 调用异常: {exc}",
        }, ensure_ascii=False)


# ── 工具定义 ──────────────────────────────────────────────────────────


@tool
def a11y_screenshot() -> str:
    """截取 Android 设备当前屏幕截图。

    返回 base64 编码的 PNG 图片数据，可以直接查看屏幕内容。
    适用于：需要了解当前界面状态、视觉确认操作结果。
    """
    return _ipc_call(["android-a11y-cli", "ui", "screenshot", "--inline"], timeout=15.0)


@tool
def a11y_ui_dump() -> str:
    """导出 Android 当前界面的 UI 树结构 (JSON)。

    返回所有可见节点的信息：文本、resourceId、className、bounds、clickable 等。
    适用于：查找要点击的元素、了解页面结构、定位输入框。
    """
    return _ipc_call(["android-a11y-cli", "ui", "dump", "--compact"], timeout=15.0)


@tool
def a11y_tap_text(text: str) -> str:
    """点击屏幕上包含指定文本的元素。

    Args:
        text: 要点击的元素文本，例如 "登录" 或 "确定"。
    """
    return _ipc_call(["android-a11y-cli", "tap", "text", text])


@tool
def a11y_tap_xy(x: int, y: int) -> str:
    """点击屏幕上的指定坐标。

    Args:
        x: 横坐标（像素）。
        y: 纵坐标（像素）。
    """
    return _ipc_call(["android-a11y-cli", "tap", "xy", str(x), str(y)])


@tool
def a11y_input_text(text: str, node_id: str = "") -> str:
    """在指定输入框中输入文本。

    Args:
        text: 要输入的文本内容。
        node_id: 目标输入框的节点 ID（从 a11y_ui_dump 获取）。留空则输入到当前焦点输入框。
    """
    argv = ["android-a11y-cli", "input", "text", text]
    if node_id:
        argv.extend(["--node", node_id])
    return _ipc_call(argv)


@tool
def a11y_input_key(key: str) -> str:
    """模拟 Android 按键。

    Args:
        key: 按键名称，支持：BACK（返回）、HOME（桌面）、RECENTS（最近任务）、NOTIFICATIONS（通知栏）。
    """
    return _ipc_call(["android-a11y-cli", "input", "key", key.upper()])


@tool
def a11y_scroll(direction: str, x: int = 500, y: int = 1000, times: int = 1) -> str:
    """在屏幕上滚动页面。

    Args:
        direction: 滚动方向，可选：up（上）、down（下）、left（左）、right（右）。
        x: 滚动起始横坐标，默认 500。
        y: 滚动起始纵坐标，默认 1000。
        times: 滚动次数，默认 1。
    """
    argv = [
        "android-a11y-cli", "scroll", "xy", str(x), str(y),
        "--direction", direction.lower(),
        "--times", str(times),
    ]
    return _ipc_call(argv)


@tool
def a11y_wait_appear(text: str, timeout: int = 10) -> str:
    """等待屏幕上出现包含指定文本的元素。

    Args:
        text: 要等待出现的文本内容。
        timeout: 最大等待时间（秒），默认 10。
    """
    return _ipc_call(
        ["android-a11y-cli", "wait", "appear", "--text", text, "--timeout", str(timeout)],
        timeout=timeout + 5.0,
    )

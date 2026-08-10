"""Safe calculator built-in tool."""

from __future__ import annotations

import ast
import operator
from typing import Any

from langchain_core.tools import tool


_SUPPORTED_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
}


def _eval_node(node: ast.AST) -> Any:
    """安全求值 AST 节点；仅支持数值运算，拒绝名称调用和属性访问。"""
    if isinstance(node, ast.Expression):
        return _eval_node(node.body)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.BinOp):
        op_type = type(node.op)
        if op_type not in _SUPPORTED_OPS:
            raise ValueError(f"不支持的二元运算符: {op_type.__name__}")
        return _SUPPORTED_OPS[op_type](_eval_node(node.left), _eval_node(node.right))
    if isinstance(node, ast.UnaryOp):
        op_type = type(node.op)
        if op_type not in _SUPPORTED_OPS:
            raise ValueError(f"不支持的一元运算符: {op_type.__name__}")
        return _SUPPORTED_OPS[op_type](_eval_node(node.operand))
    raise ValueError(f"不支持的表达式类型: {type(node).__name__}")


@tool
def calculator_tool(expression: str) -> str:
    """安全地计算简单数学表达式。

    支持 +、-、*、/、//、%、** 和括号。
    例如："(4 + 5) * 2"、"2 ** 10"、"100 // 3"。

    Args:
        expression: 数学表达式字符串。
    """
    try:
        tree = ast.parse(expression, mode="eval")
        result = _eval_node(tree)
        return str(result)
    except Exception as exc:  # noqa: BLE001
        return f"计算错误: {exc}"

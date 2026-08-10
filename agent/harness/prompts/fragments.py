"""共享 prompt 片段（TODO）。

后续可在此沉淀跨 prompt 复用的片段，例如：
- 日期/时间格式说明
- 安全与隐私约束
- 拒绝回答的固定话术
"""

TOOL_USE_HINT: str = (
    "Use a tool only when it helps answer the user's request. "
    "When you need a tool, respond with a tool call and wait for the result."
)

"""Prompt package for the lead agent harness.

按角色/场景拆分 prompt，便于后续扩展：
- system: 系统级 prompt
- planner: 任务规划 prompt（待完善）
- responder: 最终回复生成 prompt（待完善）
- fragments: 共享 prompt 片段
"""

from agent.harness.prompts.system import SYSTEM_PROMPT

__all__ = ["SYSTEM_PROMPT"]

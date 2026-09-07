-- 为知识条目添加消息来源字段,用于B4「对话消息一键存为知识」
-- source_thread_id:来源会话的 thread_id(LangGraph thread ID)
-- source_msg_id:来源消息的 ID(LangGraph message UUID)
-- source_role:来源消息角色(user/agent)
-- 这三个字段允许为空(手动创建的知识条目没有来源)
ALTER TABLE knowledge_items
  ADD COLUMN IF NOT EXISTS source_thread_id VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS source_msg_id VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS source_role VARCHAR(16) NULL;

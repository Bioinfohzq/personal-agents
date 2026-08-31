-- 回滚:content 恢复为 TEXT(超过 64KB 的内容会被截断)
ALTER TABLE knowledge_items
  MODIFY COLUMN content TEXT NULL;

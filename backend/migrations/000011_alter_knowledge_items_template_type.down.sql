-- 回滚 knowledge_items 表模板类型字段
ALTER TABLE knowledge_items DROP COLUMN IF EXISTS steps;
ALTER TABLE knowledge_items DROP COLUMN IF EXISTS template_type;

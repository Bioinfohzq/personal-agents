-- 回滚 commands 表模板类型字段
ALTER TABLE commands DROP COLUMN IF EXISTS steps;
ALTER TABLE commands DROP COLUMN IF EXISTS template_type;

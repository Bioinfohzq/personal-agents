-- 恢复旧的 category 字符串列
ALTER TABLE knowledge_items ADD COLUMN category VARCHAR(64) NOT NULL DEFAULT 'other' AFTER category_id;
ALTER TABLE commands ADD COLUMN category VARCHAR(64) NOT NULL DEFAULT 'other' AFTER category_id;

-- 从 categories 表回填 category 名称
UPDATE knowledge_items k
JOIN categories c ON c.id = k.category_id
SET k.category = c.slug;

UPDATE commands cmd
JOIN categories c ON c.id = cmd.category_id
SET cmd.category = c.slug;

-- 删除外键和 category_id 列
ALTER TABLE knowledge_items DROP FOREIGN KEY fk_knowledge_category_id;
ALTER TABLE knowledge_items DROP COLUMN category_id;

ALTER TABLE commands DROP FOREIGN KEY fk_commands_category_id;
ALTER TABLE commands DROP COLUMN category_id;

-- 恢复索引
DROP INDEX idx_knowledge_user_category ON knowledge_items;
CREATE INDEX idx_knowledge_user_category ON knowledge_items (user_id, category);

DROP INDEX idx_commands_user_category ON commands;
CREATE INDEX idx_commands_user_category ON commands (user_id, category);

-- 删除分类表
DROP TABLE IF EXISTS categories;

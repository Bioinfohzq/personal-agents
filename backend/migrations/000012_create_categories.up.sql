-- 分类表:统一存储知识库和命令手册的分类
-- PG 迁移说明:只建表,不插初始分类(历史用户分类由数据迁移脚本导入,
-- 新分类由应用层 ResolveOrCreate 按需创建)
CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NULL,
  scope VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  slug VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_categories_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
-- PG 中 NULL 不参与唯一约束冲突,使用部分唯一索引替代 MySQL 的 UNIQUE KEY
CREATE UNIQUE INDEX IF NOT EXISTS uk_categories_scope_user_slug
  ON categories (scope, user_id, slug);
CREATE INDEX IF NOT EXISTS idx_categories_scope_user ON categories (scope, user_id);

-- 回补业务表对 categories 的外键(表已在 000005/000009 建立)
ALTER TABLE knowledge_items
  ADD CONSTRAINT fk_knowledge_category_id FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT;
ALTER TABLE commands
  ADD CONSTRAINT fk_commands_category_id FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT;

-- 知识库表:存储用户结构化整理的知识点
-- PG 迁移说明:原 MySQL 000009~000015 是渐进式加列,PG 一次性按最终形态建表
--   template_type  知识类型(article/procedure/comparison/document)
--   steps          流程模板步骤列表(JSONB)
--   comparison     对比模板表格数据(JSONB)
--   content        文档模板为 Markdown 全文,PG TEXT 无长度限制,无需 MEDIUMTEXT
CREATE TABLE IF NOT EXISTS knowledge_items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  category_id BIGINT NOT NULL,
  sub_category VARCHAR(64) NULL,
  tags VARCHAR(255) NULL,
  summary TEXT NULL,
  content TEXT NULL,
  notes TEXT NULL,
  reference_url VARCHAR(512) NULL,
  extra JSONB NULL,
  template_type VARCHAR(32) NOT NULL DEFAULT 'article',
  steps JSONB NULL,
  comparison JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_knowledge_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_knowledge_user_category ON knowledge_items (user_id, category_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_user_tags ON knowledge_items (user_id, tags);

-- 命令手册表:存储用户记录的各类命令及个人理解
-- PG 迁移说明:原 MySQL 000005~000011 是渐进式加列,PG 一次性按最终形态建表
CREATE TABLE IF NOT EXISTS commands (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  command_text TEXT NOT NULL,
  category_id BIGINT NOT NULL,
  sub_category VARCHAR(64) NULL,
  introduction TEXT NULL,
  parameters TEXT NULL,
  scenarios TEXT NULL,
  notes TEXT NULL,
  reference_url VARCHAR(2048) NULL,
  template_type VARCHAR(32) NOT NULL DEFAULT 'article',
  steps JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_commands_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_commands_user_category ON commands (user_id, category_id);

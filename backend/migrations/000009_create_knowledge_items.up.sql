-- 知识库表:存储用户结构化整理的知识点
-- 支持多种知识类型:系统文件层级、URL 资源、硬件知识、算法学习等
--   category        一级知识类型(system-path / url-resource / hardware / algorithm / other)
--   sub_category    二级分类,如 macOS / Linux / 前端算法 / CPU
--   tags            标签,逗号分隔
--   summary         一句话摘要
--   content         正文内容(通用)
--   notes           个人理解/笔记
--   reference_url   参考链接
--   extra           JSON 格式存储各类型专属字段
-- user_id 关联 users 表,通过外键级联删除
CREATE TABLE IF NOT EXISTS knowledge_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT 'other',
  sub_category VARCHAR(64) NULL,
  tags VARCHAR(255) NULL,
  summary TEXT NULL,
  content TEXT NULL,
  notes TEXT NULL,
  reference_url VARCHAR(512) NULL,
  extra JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_knowledge_user_category (user_id, category),
  KEY idx_knowledge_user_tags (user_id, tags),
  CONSTRAINT fk_knowledge_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

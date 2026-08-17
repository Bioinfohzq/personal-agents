-- 命令手册表:存储用户记录的各类命令及个人理解
-- 字段:标题(兼一句话含义) + 完整命令 + 一级分类 + 二级分类 + 参数说明 + 个人理解
--   title           合并了"标题"和"一句话含义",既是命令名也是简短说明
--   category        一级分类:语言/类型(linux / python / java / git / docker / sql / other)
--   sub_category    二级分类:命令大类(如 linux 下:文件管理 / 磁盘管理 / 进程管理...)
--   parameters      三级参数说明,多行文本,每行格式 "参数|全称|含义"
--   notes           我的理解:个人笔记、坑点、示例(支持多行)
-- user_id 关联 users 表,通过外键级联删除
CREATE TABLE IF NOT EXISTS commands (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  command_text TEXT NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT 'other',
  sub_category VARCHAR(64) NULL,
  parameters TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_commands_user_category (user_id, category),
  CONSTRAINT fk_commands_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

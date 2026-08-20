-- 分类表:统一存储知识库和命令手册的分类
-- 使用存储过程实现幂等迁移,支持重复执行

-- Step 1: 创建 categories 表(如果不存在)
CREATE TABLE IF NOT EXISTS categories (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NULL,
  scope VARCHAR(32) NOT NULL,
  name VARCHAR(64) NOT NULL,
  slug VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_categories_scope_user_slug (scope, user_id, slug),
  KEY idx_categories_scope_user (scope, user_id),
  CONSTRAINT fk_categories_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Step 2: 插入初始分类（幂等：先检查是否已存在，避免重复）
-- 使用 INSERT IGNORE + 唯一键双重保障
INSERT IGNORE INTO categories (scope, name, slug, sort_order) VALUES
  ('knowledge', '系统文件层级', 'system-path', 1),
  ('knowledge', 'URL 资源', 'url-resource', 2),
  ('knowledge', '硬件知识', 'hardware', 3),
  ('knowledge', '算法学习', 'algorithm', 4),
  ('knowledge', '其他', 'other', 99);

INSERT IGNORE INTO categories (scope, name, slug, sort_order) VALUES
  ('command', 'Linux 命令', 'linux', 1),
  ('command', 'Python', 'python', 2),
  ('command', 'Java', 'java', 3),
  ('command', 'Git', 'git', 4),
  ('command', 'Docker', 'docker', 5),
  ('command', 'SQL', 'sql', 6),
  ('command', '其他', 'other', 99);

-- 清理可能存在的重复分类（保留每组 id 最小的）
DELETE c1 FROM categories c1
INNER JOIN categories c2
  ON c1.scope = c2.scope AND c1.slug = c2.slug AND c1.id > c2.id
WHERE c1.user_id IS NULL;

-- Step 3: 使用存储过程处理条件逻辑
DELIMITER //

DROP PROCEDURE IF EXISTS migrate_000012//

CREATE PROCEDURE migrate_000012()
BEGIN
  DECLARE has_knowledge_category_col INT DEFAULT 0;
  DECLARE has_commands_category_col INT DEFAULT 0;
  DECLARE has_knowledge_category_id_col INT DEFAULT 0;
  DECLARE has_commands_category_id_col INT DEFAULT 0;
  DECLARE has_fk_knowledge INT DEFAULT 0;
  DECLARE has_fk_commands INT DEFAULT 0;
  DECLARE has_idx_knowledge INT DEFAULT 0;
  DECLARE has_idx_commands INT DEFAULT 0;

  -- 检查旧 category 列是否存在
  SELECT COUNT(*) INTO has_knowledge_category_col
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'knowledge_items' AND COLUMN_NAME = 'category';

  SELECT COUNT(*) INTO has_commands_category_col
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'commands' AND COLUMN_NAME = 'category';

  -- 检查 category_id 列是否存在
  SELECT COUNT(*) INTO has_knowledge_category_id_col
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'knowledge_items' AND COLUMN_NAME = 'category_id';

  SELECT COUNT(*) INTO has_commands_category_id_col
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'commands' AND COLUMN_NAME = 'category_id';

  -- 添加 category_id 列(如果不存在)
  IF has_knowledge_category_id_col = 0 THEN
    SET @sql = IF(has_knowledge_category_col > 0,
      'ALTER TABLE knowledge_items ADD COLUMN category_id BIGINT NULL AFTER category',
      'ALTER TABLE knowledge_items ADD COLUMN category_id BIGINT NULL');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;

  IF has_commands_category_id_col = 0 THEN
    SET @sql = IF(has_commands_category_col > 0,
      'ALTER TABLE commands ADD COLUMN category_id BIGINT NULL AFTER category',
      'ALTER TABLE commands ADD COLUMN category_id BIGINT NULL');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;

  -- 迁移数据(仅当旧 category 列存在时)
  IF has_knowledge_category_col > 0 THEN
    INSERT INTO categories (user_id, scope, name, slug, sort_order)
    SELECT DISTINCT k.user_id, 'knowledge', k.category, k.category, 50
    FROM knowledge_items k
    LEFT JOIN categories c ON c.scope = 'knowledge' AND c.user_id IS NULL AND c.slug = k.category
    WHERE c.id IS NULL AND k.user_id IS NOT NULL;

    UPDATE knowledge_items k
    SET k.category_id = (
      SELECT c.id FROM categories c
      WHERE c.scope = 'knowledge' AND c.slug = k.category
        AND (c.user_id = k.user_id OR c.user_id IS NULL)
      ORDER BY c.user_id IS NULL ASC
      LIMIT 1
    );
  END IF;

  IF has_commands_category_col > 0 THEN
    INSERT INTO categories (user_id, scope, name, slug, sort_order)
    SELECT DISTINCT cmd.user_id, 'command', cmd.category, cmd.category, 50
    FROM commands cmd
    LEFT JOIN categories c ON c.scope = 'command' AND c.user_id IS NULL AND c.slug = cmd.category
    WHERE c.id IS NULL AND cmd.user_id IS NOT NULL;

    UPDATE commands cmd
    SET cmd.category_id = (
      SELECT c.id FROM categories c
      WHERE c.scope = 'command' AND c.slug = cmd.category
        AND (c.user_id = cmd.user_id OR c.user_id IS NULL)
      ORDER BY c.user_id IS NULL ASC
      LIMIT 1
    );
  END IF;

  -- 确保 category_id 不为空
  IF has_knowledge_category_id_col = 0 OR has_knowledge_category_col > 0 THEN
    ALTER TABLE knowledge_items MODIFY category_id BIGINT NOT NULL;
  END IF;

  IF has_commands_category_id_col = 0 OR has_commands_category_col > 0 THEN
    ALTER TABLE commands MODIFY category_id BIGINT NOT NULL;
  END IF;

  -- 检查旧索引是否存在
  SELECT COUNT(*) INTO has_idx_knowledge
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'knowledge_items' AND INDEX_NAME = 'idx_knowledge_user_category';

  SELECT COUNT(*) INTO has_idx_commands
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'commands' AND INDEX_NAME = 'idx_commands_user_category';

  -- 删除旧索引前需要先删除依赖它的外键约束(fk_*_user_id)
  -- MySQL 不允许删除被外键引用的索引
  -- 旧索引 idx_*_user_category(user_id, category) 被 fk_*_user_id(user_id) 引用
  -- 所以需要先删 fk_*_user_id,删旧索引,建新索引,再重建 fk_*_user_id

  -- knowledge_items 表
  IF has_idx_knowledge > 0 THEN
    -- 先删除 fk_knowledge_user_id(如果存在)
    SET @fk_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'knowledge_items' AND CONSTRAINT_NAME = 'fk_knowledge_user_id');
    IF @fk_exists > 0 THEN
      ALTER TABLE knowledge_items DROP FOREIGN KEY fk_knowledge_user_id;
    END IF;

    -- 删除旧索引
    DROP INDEX idx_knowledge_user_category ON knowledge_items;

    -- 创建新索引
    CREATE INDEX idx_knowledge_user_category ON knowledge_items (user_id, category_id);

    -- 重建 fk_knowledge_user_id
    IF @fk_exists > 0 THEN
      ALTER TABLE knowledge_items ADD CONSTRAINT fk_knowledge_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
  END IF;

  -- commands 表
  IF has_idx_commands > 0 THEN
    -- 先删除 fk_commands_user_id(如果存在)
    SET @fk_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'commands' AND CONSTRAINT_NAME = 'fk_commands_user_id');
    IF @fk_exists > 0 THEN
      ALTER TABLE commands DROP FOREIGN KEY fk_commands_user_id;
    END IF;

    -- 删除旧索引
    DROP INDEX idx_commands_user_category ON commands;

    -- 创建新索引
    CREATE INDEX idx_commands_user_category ON commands (user_id, category_id);

    -- 重建 fk_commands_user_id
    IF @fk_exists > 0 THEN
      ALTER TABLE commands ADD CONSTRAINT fk_commands_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
    END IF;
  END IF;

  -- 检查 category 外键是否存在
  SELECT COUNT(*) INTO has_fk_knowledge
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'knowledge_items' AND CONSTRAINT_NAME = 'fk_knowledge_category_id';

  SELECT COUNT(*) INTO has_fk_commands
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'commands' AND CONSTRAINT_NAME = 'fk_commands_category_id';

  -- 添加外键约束
  IF has_fk_knowledge = 0 THEN
    ALTER TABLE knowledge_items ADD CONSTRAINT fk_knowledge_category_id FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT;
  END IF;

  IF has_fk_commands = 0 THEN
    ALTER TABLE commands ADD CONSTRAINT fk_commands_category_id FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT;
  END IF;

  -- 删除旧 category 列
  IF has_knowledge_category_col > 0 THEN
    ALTER TABLE knowledge_items DROP COLUMN category;
  END IF;

  IF has_commands_category_col > 0 THEN
    ALTER TABLE commands DROP COLUMN category;
  END IF;
END//

DELIMITER ;

CALL migrate_000012();

DROP PROCEDURE IF EXISTS migrate_000012;

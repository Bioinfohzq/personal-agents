-- 删除 categories 表的 is_fixed 列
-- 所有分类现在都是平等的,用户可以自由重命名或删除任何分类

-- 检查 is_fixed 列是否存在,存在则删除
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories' AND COLUMN_NAME = 'is_fixed');

SET @sql = IF(@col_exists > 0,
  'ALTER TABLE categories DROP COLUMN is_fixed',
  'SELECT "is_fixed column not found, skipping" AS info');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 命令手册表新增使用场景字段
-- scenarios 为多行文本,每行描述一个使用场景及其示例命令。
ALTER TABLE commands ADD COLUMN scenarios TEXT NULL AFTER parameters;

-- 回滚：恢复 users 表为原始结构（username/email NOT NULL，删除 phone 列）
-- 注意：回滚前应确保没有用户的 phone 字段有值，否则会丢失数据

-- username 恢复 NOT NULL
ALTER TABLE users
  MODIFY COLUMN username VARCHAR(64) NOT NULL;

-- email 恢复 NOT NULL
ALTER TABLE users
  MODIFY COLUMN email VARCHAR(255) NOT NULL;

-- 删除 phone 列及索引
ALTER TABLE users
  DROP INDEX uk_users_phone,
  DROP COLUMN phone;

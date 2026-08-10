-- 用户表账号字段改造：支持用户名/手机号/邮箱三选一注册
-- 1. 新增 phone 列（允许 NULL，UNIQUE）
-- 2. username 从 NOT NULL 改为允许 NULL（用手机号/邮箱注册时为空）
-- 3. email 从 NOT NULL 改为允许 NULL（用用户名/手机号注册时为空）
-- MySQL 的 UNIQUE 约束允许任意多个 NULL 值，所以不会互相冲突

-- 新增 phone 列及唯一索引
ALTER TABLE users
  ADD COLUMN phone VARCHAR(20) NULL AFTER username,
  ADD UNIQUE KEY uk_users_phone (phone);

-- username 改为允许 NULL
ALTER TABLE users
  MODIFY COLUMN username VARCHAR(64) NULL;

-- email 改为允许 NULL
ALTER TABLE users
  MODIFY COLUMN email VARCHAR(255) NULL;

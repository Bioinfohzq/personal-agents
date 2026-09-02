-- PG 迁移说明:000001 建表时已按最终形态(username/phone/email 均可 NULL)创建,
-- 本迁移只补 phone 列及其部分唯一索引
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_users_phone ON users (phone) WHERE phone IS NOT NULL;

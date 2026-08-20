-- 回滚:恢复 is_fixed 列,并将原始固定分类标记为 TRUE
ALTER TABLE categories ADD COLUMN is_fixed BOOLEAN NOT NULL DEFAULT FALSE;

-- 将原始固定分类(slug 为以下值且 user_id 为 NULL 的)标记为固定
UPDATE categories SET is_fixed = TRUE
WHERE user_id IS NULL AND slug IN (
  'system-path', 'url-resource', 'hardware', 'algorithm', 'other',
  'linux', 'python', 'java', 'git', 'docker', 'sql'
);

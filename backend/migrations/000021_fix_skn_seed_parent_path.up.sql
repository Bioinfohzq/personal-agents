-- 修复内置 Linux FHS 节点的 parent_path
-- 根节点 "/" 的 parent_path 保持空串 "";其他一级子目录(bin/etc/usr/var 等)的 parent_path 应为 "/"
UPDATE system_knowledge_nodes
SET parent_path = '/'
WHERE user_id = 0
  AND category = 'linux-fhs'
  AND parent_path = ''
  AND path != '/';

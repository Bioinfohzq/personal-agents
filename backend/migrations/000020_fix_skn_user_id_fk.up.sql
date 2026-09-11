-- 修复 system_knowledge_nodes 外键约束
-- user_id=0 表示内置节点(系统预置数据),users 表中无 id=0 的记录,需要移除外键约束
ALTER TABLE system_knowledge_nodes DROP CONSTRAINT IF EXISTS system_knowledge_nodes_user_id_fkey;

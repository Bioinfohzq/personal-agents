-- 系统底层知识节点表
-- 用于存储用户自定义的系统知识结构(Linux FHS、系统调用、进程调度、内存管理、驱动、CPU原理等分类)
-- 内置节点以 seed 数据写入(user_id=0),用户自定义节点带 user_id
-- 前端一次拉取整棵树后本地渲染
CREATE TABLE system_knowledge_nodes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT       NOT NULL DEFAULT 0 REFERENCES users(id) ON DELETE CASCADE,
    -- 分类: linux-fhs/syscall/process/memory/driver/cpu
    category    VARCHAR(50)  NOT NULL DEFAULT 'linux-fhs',
    -- 父节点完整路径,根节点为空串
    parent_path VARCHAR(500) NOT NULL DEFAULT '',
    -- 节点完整路径,如 '/' '/etc' '/etc/nginx'
    path        VARCHAR(500) NOT NULL,
    -- 显示名称
    name        VARCHAR(200) NOT NULL,
    -- 类型: dir/file
    node_type   VARCHAR(20)  NOT NULL DEFAULT 'dir',
    -- 作用说明
    description TEXT         NOT NULL DEFAULT '',
    -- 存放内容
    contents    TEXT         NOT NULL DEFAULT '',
    -- 常见文件/目录示例数组
    examples    JSONB        NOT NULL DEFAULT '[]'::JSONB,
    -- 同级排序权重(内置节点固定顺序,自定义节点追加在后)
    sort_order  INTEGER      NOT NULL DEFAULT 0,
    -- 是否系统内置(内置节点不可删除,编辑时以用户覆盖方式存储)
    is_builtin  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 同一用户同分类同路径唯一(允许用户覆盖内置节点:user_id=0的是内置,user_id=X的是用户覆盖)
CREATE UNIQUE INDEX idx_skn_user_cat_path ON system_knowledge_nodes(user_id, category, path);
CREATE INDEX idx_skn_user_cat_parent ON system_knowledge_nodes(user_id, category, parent_path);
CREATE INDEX idx_skn_user_cat ON system_knowledge_nodes(user_id, category);

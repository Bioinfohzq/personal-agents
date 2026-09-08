-- 长期记忆表(B7)
-- 记忆用于存储AI从对话中识别并经用户确认的个人事实、偏好、项目约定、踩坑教训
-- 与 knowledge_items/commands 平级,通过 embeddings 表 source_type='memory' 关联向量
CREATE TABLE memories (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic       VARCHAR(50)  NOT NULL,            -- 主题分类: personal_fact/tech_preference/project_convention/lesson_learned/communication_style
    title       VARCHAR(200) NOT NULL,            -- 简短标题(列表、摘要展示用)
    content     TEXT         NOT NULL,            -- 记忆正文
    importance  SMALLINT     NOT NULL DEFAULT 3, -- 重要度1-5, ≥4的"核心记忆"会在对话启动时预注入system prompt
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE, -- 是否激活: FALSE=归档,不预注入但仍可语义检索
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_memories_user_id ON memories(user_id);
CREATE INDEX idx_memories_user_active ON memories(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_memories_topic ON memories(user_id, topic);

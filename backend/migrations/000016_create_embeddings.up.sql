-- 统一向量表:多态关联所有需要语义检索的内容源(知识/命令/对话消息/长期记忆)
-- 设计要点:
--   (source_type, source_id, chunk_index) 唯一:重新向量化时删旧插新幂等
--   chunk_text 冗余存块原文:检索命中后无需回查源表即可直接用于 RAG
--   embedding_model 记录计算向量的模型:换模型时按此识别过期向量并全量重算
--   维度 1024:embedding 模型最普遍的维度(DashScope/bge-m3 均为 1024)
-- 注意:source_id 无法建数据库外键(多态指向),删除源记录时须由应用层
--       在同一事务中显式删除对应向量(事务双删)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS embeddings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source_type VARCHAR(32) NOT NULL,
  source_id BIGINT NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  embedding vector(1024) NOT NULL,
  embedding_model VARCHAR(64) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uk_embeddings_source_chunk UNIQUE (source_type, source_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_user_source ON embeddings (user_id, source_type);
-- HNSW 近似最近邻索引,余弦距离(个人数据量小,建了备用,未来免迁移)
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON embeddings USING hnsw (embedding vector_cosine_ops);

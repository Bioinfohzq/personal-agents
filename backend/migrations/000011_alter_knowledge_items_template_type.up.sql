-- knowledge_items 表新增模板类型字段
-- template_type 用于区分文章模板(article)和流程模板(procedure)
ALTER TABLE knowledge_items
  ADD COLUMN template_type VARCHAR(32) NOT NULL DEFAULT 'article'
    COMMENT '模板类型: article=文章模板, procedure=流程模板';

ALTER TABLE knowledge_items
  ADD COLUMN steps JSON NULL
    COMMENT '流程模板步骤列表,仅 template_type=procedure 时使用';

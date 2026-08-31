-- knowledge_items.content 升级为 MEDIUMTEXT
-- 文档模板(document)直接将 Markdown 全文存入 content,TEXT 上限 64KB 不够
ALTER TABLE knowledge_items
  MODIFY COLUMN content MEDIUMTEXT NULL
    COMMENT '正文:文章模板为详细介绍,文档模板为 Markdown 全文';

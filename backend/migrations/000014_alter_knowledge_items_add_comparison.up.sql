-- knowledge_items 表新增对比模板字段
-- comparison 用于存储对比表格数据,仅 template_type=comparison 时使用
-- 格式: {"headers": ["列名1","列名2",...], "rows": [["维度","值1","值2",...], ...]}
ALTER TABLE knowledge_items
  ADD COLUMN comparison JSON NULL
    COMMENT '对比模板表格数据,仅 template_type=comparison 时使用';

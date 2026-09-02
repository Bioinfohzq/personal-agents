ALTER TABLE commands DROP CONSTRAINT IF EXISTS fk_commands_category_id;
ALTER TABLE knowledge_items DROP CONSTRAINT IF EXISTS fk_knowledge_category_id;
DROP TABLE IF EXISTS categories;

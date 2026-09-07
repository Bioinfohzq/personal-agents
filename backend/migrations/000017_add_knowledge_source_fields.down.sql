ALTER TABLE knowledge_items
  DROP COLUMN IF EXISTS source_thread_id,
  DROP COLUMN IF EXISTS source_msg_id,
  DROP COLUMN IF EXISTS source_role;

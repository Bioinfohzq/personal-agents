CREATE TABLE IF NOT EXISTS passwordbook_items (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  platform VARCHAR(128) NOT NULL,
  login_account VARCHAR(255) NOT NULL,
  password_ciphertext TEXT NOT NULL,
  login_url VARCHAR(512) NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_passwordbook_items_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_passwordbook_items_user_updated_at ON passwordbook_items (user_id, updated_at);

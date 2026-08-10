CREATE TABLE IF NOT EXISTS passwordbook_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  platform VARCHAR(128) NOT NULL,
  login_account VARCHAR(255) NOT NULL,
  password_ciphertext TEXT NOT NULL,
  login_url VARCHAR(512) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_passwordbook_items_user_updated_at (user_id, updated_at),
  CONSTRAINT fk_passwordbook_items_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

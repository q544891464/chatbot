-- Add per-entry conversation isolation for the H5 chatbot.
-- Run this against the chatbot database in production.

USE chatbot;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversations'
    AND COLUMN_NAME = 'app_variant'
);
SET @sql := IF(
  @column_exists = 0,
  "ALTER TABLE conversations ADD COLUMN app_variant VARCHAR(64) NOT NULL DEFAULT 'default' AFTER user_id",
  "SELECT 'conversations.app_variant already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS user_variant_states (
  user_id BIGINT UNSIGNED NOT NULL,
  app_variant VARCHAR(64) NOT NULL DEFAULT 'default',
  active_conversation_key VARCHAR(64) DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, app_variant),
  CONSTRAINT fk_user_variant_states_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO user_variant_states (user_id, app_variant, active_conversation_key)
SELECT id, 'default', active_conversation_key
FROM users
WHERE active_conversation_key IS NOT NULL
ON DUPLICATE KEY UPDATE
  active_conversation_key = VALUES(active_conversation_key);

SET @old_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversations'
    AND INDEX_NAME = 'uniq_user_conversation'
);
SET @sql := IF(
  @old_unique_exists > 0,
  "ALTER TABLE conversations DROP INDEX uniq_user_conversation",
  "SELECT 'uniq_user_conversation already absent'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @new_unique_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversations'
    AND INDEX_NAME = 'uniq_user_variant_conversation'
);
SET @sql := IF(
  @new_unique_exists = 0,
  "ALTER TABLE conversations ADD UNIQUE KEY uniq_user_variant_conversation (user_id, app_variant, conversation_key)",
  "SELECT 'uniq_user_variant_conversation already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @old_updated_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversations'
    AND INDEX_NAME = 'idx_user_updated'
);
SET @sql := IF(
  @old_updated_idx_exists > 0,
  "ALTER TABLE conversations DROP INDEX idx_user_updated",
  "SELECT 'idx_user_updated already absent'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @new_updated_idx_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'conversations'
    AND INDEX_NAME = 'idx_user_variant_updated'
);
SET @sql := IF(
  @new_updated_idx_exists = 0,
  "ALTER TABLE conversations ADD KEY idx_user_variant_updated (user_id, app_variant, updated_at_ms)",
  "SELECT 'idx_user_variant_updated already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


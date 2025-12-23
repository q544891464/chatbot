-- MySQL schema for H5 chatbot conversations

CREATE DATABASE IF NOT EXISTS chatbot
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE chatbot;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_key VARCHAR(128) NOT NULL,
  active_conversation_key VARCHAR(64) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_key (user_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  conversation_key VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  platform VARCHAR(16) NOT NULL,
  dify_conversation_id VARCHAR(128) DEFAULT NULL,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_conversation (user_id, conversation_key),
  KEY idx_user_updated (user_id, updated_at_ms),
  CONSTRAINT fk_conversations_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(16) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  time_label VARCHAR(16) NOT NULL DEFAULT '',
  position INT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_conversation_position (conversation_id, position),
  KEY idx_conversation_time (conversation_id, created_at_ms),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

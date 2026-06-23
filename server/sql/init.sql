-- MySQL schema for H5 chatbot conversations

CREATE DATABASE IF NOT EXISTS chatbot
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE chatbot;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_key VARCHAR(128) NOT NULL,
  user_name VARCHAR(128) DEFAULT NULL,
  phone VARCHAR(32) DEFAULT NULL,
  org_id VARCHAR(64) DEFAULT NULL,
  org_name VARCHAR(255) DEFAULT NULL,
  department_id VARCHAR(64) DEFAULT NULL,
  department_name VARCHAR(255) DEFAULT NULL,
  department_path VARCHAR(1024) DEFAULT NULL,
  auth_source VARCHAR(64) DEFAULT NULL,
  profile_updated_at TIMESTAMP NULL DEFAULT NULL,
  active_conversation_key VARCHAR(64) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_key (user_key),
  KEY idx_users_org_department (org_id, department_id),
  KEY idx_users_department_name (department_name),
  KEY idx_users_department_path (department_path(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  app_variant VARCHAR(64) NOT NULL DEFAULT 'default',
  conversation_key VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  platform VARCHAR(16) NOT NULL,
  dify_conversation_id VARCHAR(128) DEFAULT NULL,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_user_variant_conversation (user_id, app_variant, conversation_key),
  KEY idx_user_variant_updated (user_id, app_variant, updated_at_ms),
  CONSTRAINT fk_conversations_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_variant_states (
  user_id BIGINT UNSIGNED NOT NULL,
  app_variant VARCHAR(64) NOT NULL DEFAULT 'default',
  active_conversation_key VARCHAR(64) DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, app_variant),
  CONSTRAINT fk_user_variant_states_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chatbot_address_book_departments (
  department_id VARCHAR(64) NOT NULL,
  department_name VARCHAR(255) NOT NULL,
  parent_department_id VARCHAR(64) DEFAULT NULL,
  department_path VARCHAR(1024) DEFAULT NULL,
  department_path_json TEXT DEFAULT NULL,
  member_count INT DEFAULT NULL,
  hide_count INT DEFAULT NULL,
  sort_index INT DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (department_id),
  KEY idx_address_book_departments_parent (parent_department_id),
  KEY idx_address_book_departments_name (department_name),
  KEY idx_address_book_departments_path (department_path(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS chatbot_address_book_users (
  phone VARCHAR(32) NOT NULL,
  user_name VARCHAR(128) DEFAULT NULL,
  union_id VARCHAR(128) DEFAULT NULL,
  customer_id VARCHAR(128) DEFAULT NULL,
  department_id VARCHAR(64) DEFAULT NULL,
  department_name VARCHAR(255) DEFAULT NULL,
  department_path VARCHAR(1024) DEFAULT NULL,
  department_path_json TEXT DEFAULT NULL,
  raw_json JSON DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (phone),
  KEY idx_address_book_users_department (department_id),
  KEY idx_address_book_users_name (user_name),
  KEY idx_address_book_users_department_path (department_path(255)),
  CONSTRAINT fk_address_book_users_department FOREIGN KEY (department_id)
    REFERENCES chatbot_address_book_departments(department_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  role VARCHAR(16) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  external_message_id VARCHAR(128) DEFAULT NULL,
  time_label VARCHAR(16) NOT NULL DEFAULT '',
  position INT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_conversation_position (conversation_id, position),
  KEY idx_conversation_time (conversation_id, created_at_ms),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

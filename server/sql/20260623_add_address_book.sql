-- Add address-book mapping tables and department path fields.

SET @schema_name = DATABASE();

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN department_path VARCHAR(1024) DEFAULT NULL AFTER department_name',
    'SELECT ''users.department_path already exists'''
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'department_path'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD KEY idx_users_department_path (department_path(255))',
    'SELECT ''idx_users_department_path already exists'''
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @schema_name
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'idx_users_department_path'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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

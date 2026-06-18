-- Add user profile fields for organization/department usage statistics.
-- Run this against the configured chatbot database in production.

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'user_name'
);
SET @sql := IF(
  @column_exists = 0,
  "ALTER TABLE users ADD COLUMN user_name VARCHAR(128) DEFAULT NULL AFTER user_key",
  "SELECT 'users.user_name already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'phone'
);
SET @sql := IF(
  @column_exists = 0,
  "ALTER TABLE users ADD COLUMN phone VARCHAR(32) DEFAULT NULL AFTER user_name",
  "SELECT 'users.phone already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'org_id'
);
SET @sql := IF(
  @column_exists = 0,
  "ALTER TABLE users ADD COLUMN org_id VARCHAR(64) DEFAULT NULL AFTER phone",
  "SELECT 'users.org_id already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'org_name'
);
SET @sql := IF(
  @column_exists = 0,
  "ALTER TABLE users ADD COLUMN org_name VARCHAR(255) DEFAULT NULL AFTER org_id",
  "SELECT 'users.org_name already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'department_id'
);
SET @sql := IF(
  @column_exists = 0,
  "ALTER TABLE users ADD COLUMN department_id VARCHAR(64) DEFAULT NULL AFTER org_name",
  "SELECT 'users.department_id already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'department_name'
);
SET @sql := IF(
  @column_exists = 0,
  "ALTER TABLE users ADD COLUMN department_name VARCHAR(255) DEFAULT NULL AFTER department_id",
  "SELECT 'users.department_name already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'auth_source'
);
SET @sql := IF(
  @column_exists = 0,
  "ALTER TABLE users ADD COLUMN auth_source VARCHAR(64) DEFAULT NULL AFTER department_name",
  "SELECT 'users.auth_source already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'profile_updated_at'
);
SET @sql := IF(
  @column_exists = 0,
  "ALTER TABLE users ADD COLUMN profile_updated_at TIMESTAMP NULL DEFAULT NULL AFTER auth_source",
  "SELECT 'users.profile_updated_at already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'idx_users_org_department'
);
SET @sql := IF(
  @index_exists = 0,
  "ALTER TABLE users ADD KEY idx_users_org_department (org_id, department_id)",
  "SELECT 'idx_users_org_department already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'idx_users_department_name'
);
SET @sql := IF(
  @index_exists = 0,
  "ALTER TABLE users ADD KEY idx_users_department_name (department_name)",
  "SELECT 'idx_users_department_name already exists'"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { normalizePhone } = require("../server/services/address-book");

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback);
}

function pathItems(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function departmentPathFromItems(items, fallbackName = "") {
  const cleanItems = pathItems(items);
  if (cleanItems.length) return cleanItems.join(" / ");
  return String(fallbackName || "").trim();
}

async function main() {
  const inputFile = process.argv[2] || path.resolve("data/address-book/openapi-address-book-latest.json");
  const raw = await fs.readFile(inputFile, "utf8");
  const data = JSON.parse(raw);
  const departments = Array.isArray(data.departments) ? data.departments : [];
  const users = Array.isArray(data.users) ? data.users : [];

  const connection = await mysql.createConnection({
    host: getEnv("DB_HOST", "127.0.0.1"),
    port: Number.parseInt(getEnv("DB_PORT", "3306"), 10),
    user: getEnv("DB_USER", "root"),
    password: getEnv("DB_PASSWORD", ""),
    database: getEnv("DB_NAME", "chatbot"),
    multipleStatements: true,
  });

  try {
    await connection.beginTransaction();

    for (const dept of departments) {
      const departmentId = String(dept.dept_id || dept.department_id || "").trim();
      if (!departmentId) continue;
      const departmentName = String(dept.name || dept.department_name || "").trim() || departmentId;
      const parentDepartmentId = dept.parent_dept_id || dept.parent_department_id || null;
      const deptPathItems = pathItems(dept.path);
      const departmentPath = departmentPathFromItems(deptPathItems, departmentName);
      await connection.execute(
        `INSERT INTO chatbot_address_book_departments (
          department_id, department_name, parent_department_id, department_path,
          department_path_json, member_count, hide_count, sort_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          department_name = VALUES(department_name),
          parent_department_id = VALUES(parent_department_id),
          department_path = VALUES(department_path),
          department_path_json = VALUES(department_path_json),
          member_count = VALUES(member_count),
          hide_count = VALUES(hide_count),
          sort_index = VALUES(sort_index),
          updated_at = CURRENT_TIMESTAMP`,
        [
          departmentId,
          departmentName,
          parentDepartmentId ? String(parentDepartmentId) : null,
          departmentPath || null,
          JSON.stringify(deptPathItems),
          Number.isFinite(Number(dept.count)) ? Number(dept.count) : null,
          Number.isFinite(Number(dept.hide_count)) ? Number(dept.hide_count) : null,
          Number.isFinite(Number(dept.index)) ? Number(dept.index) : null,
        ],
      );
    }

    let importedUsers = 0;
    for (const user of users) {
      const phone = normalizePhone(user.phone);
      if (!phone) continue;
      const departmentId = String(user.dept_id || user.department_id || "").trim();
      const departmentName = String(user.dept_name || user.department_name || "").trim();
      const deptPathItems = pathItems(user.dept_path);
      const departmentPath = departmentPathFromItems(deptPathItems, departmentName);
      await connection.execute(
        `INSERT INTO chatbot_address_book_users (
          phone, user_name, union_id, customer_id, department_id, department_name,
          department_path, department_path_json, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          user_name = VALUES(user_name),
          union_id = VALUES(union_id),
          customer_id = VALUES(customer_id),
          department_id = VALUES(department_id),
          department_name = VALUES(department_name),
          department_path = VALUES(department_path),
          department_path_json = VALUES(department_path_json),
          raw_json = VALUES(raw_json),
          updated_at = CURRENT_TIMESTAMP`,
        [
          phone,
          user.name || null,
          user.union_id || null,
          user.customer_id || null,
          departmentId || null,
          departmentName || null,
          departmentPath || null,
          JSON.stringify(deptPathItems),
          JSON.stringify(user),
        ],
      );
      importedUsers += 1;
    }

    const [updateResult] = await connection.execute(
      `UPDATE users u
       JOIN chatbot_address_book_users abu ON abu.phone = u.phone OR abu.phone = u.user_key
       SET
         u.user_name = COALESCE(NULLIF(u.user_name, ''), abu.user_name),
         u.phone = COALESCE(NULLIF(u.phone, ''), abu.phone),
         u.department_id = COALESCE(NULLIF(abu.department_id, ''), u.department_id),
         u.department_name = COALESCE(NULLIF(abu.department_name, ''), u.department_name),
         u.department_path = COALESCE(NULLIF(abu.department_path, ''), u.department_path),
         u.auth_source = COALESCE(NULLIF(u.auth_source, ''), 'address-book'),
         u.profile_updated_at = CURRENT_TIMESTAMP`,
    );

    await connection.commit();
    process.stdout.write(JSON.stringify({
      ok: true,
      inputFile,
      departments: departments.length,
      users: importedUsers,
      updatedChatbotUsers: updateResult.affectedRows || 0,
    }, null, 2) + "\n");
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  process.stderr.write(`[address-book] ERROR: ${err?.message || err}\n`);
  process.exit(1);
});

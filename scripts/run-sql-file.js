#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const mysql = require("mysql2/promise");

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback);
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    throw new Error("missing SQL file path");
  }

  const connection = await mysql.createConnection({
    host: getEnv("DB_HOST", "127.0.0.1"),
    port: Number.parseInt(getEnv("DB_PORT", "3306"), 10),
    user: getEnv("DB_USER", "root"),
    password: getEnv("DB_PASSWORD", ""),
    database: getEnv("DB_NAME", "chatbot"),
    multipleStatements: true,
  });

  try {
    for (const file of files) {
      const sql = await fs.readFile(file, "utf8");
      process.stdout.write(`[sql] running ${file}\n`);
      await connection.query(sql);
    }
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  process.stderr.write(`[sql] ERROR: ${err?.message || err}\n`);
  process.exit(1);
});


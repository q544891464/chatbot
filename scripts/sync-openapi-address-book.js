#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  return fs.readFile(filePath, "utf8").then((text) => {
    for (const originalLine of text.split(/\r?\n/)) {
      const line = originalLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

function env(name, fallback = "") {
  return String(process.env[name] ?? fallback).trim();
}

function required(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function sha512Base64(value) {
  return crypto.createHash("sha512").update(value, "utf8").digest("base64");
}

function decryptEnvelope(envelope, clientId, clientSecret) {
  if (!envelope || typeof envelope !== "object") throw new Error("OpenAPI response has no encrypted data envelope");
  const timestamp = String(envelope.timeStamp || "");
  const nonce = String(envelope.nonce || "");
  const encrypted = String(envelope.encrypt || "");
  const sign = String(envelope.sign || "").toLowerCase();
  if (!timestamp || !nonce || !encrypted || !sign) throw new Error("OpenAPI encrypted data envelope is incomplete");

  const expectedSign = crypto
    .createHmac("sha256", sha512Base64(clientId))
    .update(`${timestamp}${nonce}${encrypted}`, "utf8")
    .digest("hex");
  if (sign.length !== expectedSign.length || !crypto.timingSafeEqual(Buffer.from(expectedSign), Buffer.from(sign))) {
    throw new Error("OpenAPI response signature verification failed");
  }

  const data = Buffer.from(encrypted, "base64url");
  if (data.length <= 16 || (data.length - 16) % 16 !== 0) throw new Error("OpenAPI encrypted payload is invalid");
  const key = crypto.createHash("sha256").update(`${sha512Base64(clientSecret)}:${timestamp}:${nonce}`, "utf8").digest();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, data.subarray(0, 16));
  const plain = Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]).toString("utf8");
  return JSON.parse(plain);
}

function unwrapBusinessData(response, clientId, clientSecret) {
  const code = Number(response?.code);
  if (code !== 200) throw new Error(`OpenAPI request failed: code=${response?.code ?? "unknown"}, msg=${response?.msg || "unknown"}`);
  if (response.data && typeof response.data === "object" && response.data.encrypt) {
    return decryptEnvelope(response.data, clientId, clientSecret);
  }
  if (typeof response.data === "string") return JSON.parse(response.data);
  return response.data || {};
}

function joinUrl(baseUrl, requestPath) {
  return new URL(requestPath, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`OpenAPI HTTP ${response.status}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`OpenAPI returned invalid JSON: ${text.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function retry(label, attempts, action) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempt(s): ${lastError?.message || lastError}`);
}

async function runImport(outputFile) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "import-address-book.js"), outputFile], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Address-book import exited with code ${code}`)));
  });
}

async function main() {
  await loadEnvFile(path.join(PROJECT_ROOT, "server", ".env"));
  await loadEnvFile(path.join(__dirname, "address-book-sync.env"));

  // A deployment can use a dedicated OpenAPI application, or deliberately
  // reuse the server-side OAuth application's client credentials.
  const clientId = env("ADDRESS_BOOK_CLIENT_ID") || required("AUTH_CLIENT_ID");
  const clientSecret = env("ADDRESS_BOOK_CLIENT_SECRET") || required("AUTH_CLIENT_SECRET");
  const baseUrl = required("ADDRESS_BOOK_OPENAPI_BASE_URL").replace(/\/+$/, "");
  const rootDepartmentId = env("ADDRESS_BOOK_ROOT_DEPARTMENT_ID", "1");
  const rootDepartmentName = env("ADDRESS_BOOK_ROOT_DEPARTMENT_NAME", "root");
  const timeoutMs = Number.parseInt(env("ADDRESS_BOOK_REQUEST_TIMEOUT_MS", "30000"), 10);
  const attempts = Number.parseInt(env("ADDRESS_BOOK_REQUEST_ATTEMPTS", "3"), 10);
  const outputFile = path.resolve(PROJECT_ROOT, env("ADDRESS_BOOK_OUTPUT_FILE", "data/address-book/openapi-address-book-latest.json"));
  const minDepartments = Number.parseInt(env("ADDRESS_BOOK_MIN_DEPARTMENT_COUNT", "2"), 10);
  const minUsers = Number.parseInt(env("ADDRESS_BOOK_MIN_USER_COUNT", "1"), 10);

  const tokenResponse = await retry("OpenAPI token request", attempts, () => fetchWithTimeout(
    joinUrl(baseUrl, env("ADDRESS_BOOK_TOKEN_PATH", "/open-apis/v1/auth/token")),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: env("ADDRESS_BOOK_SCOPE", "open"), client_id: clientId, client_secret: clientSecret }),
    },
    timeoutMs,
  ));
  const accessToken = tokenResponse.access_token || tokenResponse.data?.access_token;
  if (!accessToken) throw new Error("OpenAPI token response did not contain access_token");

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=utf-8",
    client_id: clientId,
  };
  const callApi = (requestPath, body) => retry(`OpenAPI ${requestPath}`, attempts, async () => unwrapBusinessData(
    await fetchWithTimeout(joinUrl(baseUrl, requestPath), { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs),
    clientId,
    clientSecret,
  ));

  const departments = [{ dept_id: rootDepartmentId, name: rootDepartmentName, parent_dept_id: null, path: [] }];
  const queue = [{ deptId: rootDepartmentId, path: [] }];
  const usersByPhone = new Map();
  const childPath = env("ADDRESS_BOOK_DEPARTMENT_CHILDREN_PATH", "/open/v2/dept/children");
  const userPath = env("ADDRESS_BOOK_DEPARTMENT_USERS_PATH", "/open/v2/dept/users/list");

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    for (let page = 1; ; page += 1) {
      const data = await callApi(childPath, { dept_id: current.deptId, page_num: page, page_size: 32 });
      const items = Array.isArray(data.departments) ? data.departments : [];
      for (const item of items) {
        const deptId = String(item.dept_id || "").trim();
        const name = String(item.name || "").trim();
        if (!deptId || !name) throw new Error(`OpenAPI returned an invalid department under ${current.deptId}`);
        const deptPath = [...current.path, name];
        departments.push({ ...item, dept_id: deptId, name, parent_dept_id: current.deptId, path: deptPath });
        queue.push({ deptId, path: deptPath });
      }
      if (items.length === 0 || page * 32 >= Number(data.total || 0)) break;
    }

    for (let page = 1; ; page += 1) {
      const data = await callApi(userPath, { dept_id: current.deptId, page_num: page, page_size: 100 });
      const items = Array.isArray(data.users) ? data.users : [];
      for (const item of items) {
        const phone = String(item.phone || "").trim();
        if (!phone || usersByPhone.has(phone)) continue;
        usersByPhone.set(phone, {
          ...item,
          dept_id: current.deptId,
          dept_name: current.path.at(-1) || rootDepartmentName,
          dept_path: current.path,
        });
      }
      if (items.length === 0 || page * 100 >= Number(data.total || 0)) break;
    }
  }

  const users = [...usersByPhone.values()];
  if (departments.length < minDepartments || users.length < minUsers) {
    throw new Error(`OpenAPI result did not pass safety threshold: departments=${departments.length}, users=${users.length}`);
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    rootDeptId: rootDepartmentId,
    departmentCount: departments.length,
    userCount: users.length,
    errorCount: 0,
    departments,
    users,
    errors: [],
  };
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const temporaryFile = `${outputFile}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(temporaryFile, outputFile);

  if (env("ADDRESS_BOOK_IMPORT_ENABLED", "true").toLowerCase() !== "false") {
    await runImport(outputFile);
  }
  process.stdout.write(`[address-book] synced departments=${departments.length} users=${users.length} output=${outputFile}\n`);
}

main().catch((error) => {
  process.stderr.write(`[address-book] ERROR: ${error?.stack || error}\n`);
  process.exit(1);
});

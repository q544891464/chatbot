const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const mysql = require("mysql2/promise");
const { Readable } = require("node:stream");

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const DIFY_BASE_URL = String(process.env.DIFY_BASE_URL || "https://api.dify.ai/v1").replace(/\/+$/, "");
const DIFY_API_KEY = String(process.env.DIFY_API_KEY || "");
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*");
const ALT_API_URL = String(
  process.env.ALT_API_URL || "http://183.78.180.103:5050/api/chat/agent/ChatbotAgent",
);
const ALT_API_TOKEN = String(process.env.ALT_API_TOKEN || "");
const ALT_THREAD_URL = String(process.env.ALT_THREAD_URL || "");
const ALT_AGENT_ID = String(process.env.ALT_AGENT_ID || "ChatbotAgent");
const ALT_AUTH_URL = String(process.env.ALT_AUTH_URL || "");
const ALT_AUTH_USERNAME = String(process.env.ALT_AUTH_USERNAME || "");
const ALT_AUTH_PASSWORD = String(process.env.ALT_AUTH_PASSWORD || "");
const ALT_AUTH_SCOPE = String(process.env.ALT_AUTH_SCOPE || "");
const ALT_AUTH_CLIENT_ID = String(process.env.ALT_AUTH_CLIENT_ID || "");
const ALT_AUTH_CLIENT_SECRET = String(process.env.ALT_AUTH_CLIENT_SECRET || "");
const FEEDBACK_BASE_URL = String(
  process.env.FEEDBACK_BASE_URL || "http://183.78.180.103:5173",
).replace(/\/+$/, "");
const DB_HOST = String(process.env.DB_HOST || "127.0.0.1");
const DB_PORT = Number.parseInt(process.env.DB_PORT || "3306", 10);
const DB_USER = String(process.env.DB_USER || "root");
const DB_PASSWORD = String(process.env.DB_PASSWORD || "");
const DB_NAME = String(process.env.DB_NAME || "chatbot");
const DB_CONN_LIMIT = Number.parseInt(process.env.DB_CONN_LIMIT || "10", 10);
const AUTH_SERVER_DOMAIN = String(process.env.AUTH_SERVER_DOMAIN || "");
const AUTH_AUTHORIZE_PATH = String(process.env.AUTH_AUTHORIZE_PATH || "/seal/oauth2/authorize");
const AUTH_TOKEN_PATH = String(process.env.AUTH_TOKEN_PATH || "/seal/oauth2/token");
const AUTH_USERINFO_PATH = String(process.env.AUTH_USERINFO_PATH || "/seal/userinfo");
const AUTH_CLIENT_ID = String(process.env.AUTH_CLIENT_ID || "");
const AUTH_CLIENT_SECRET = String(process.env.AUTH_CLIENT_SECRET || "");
const AUTH_REDIRECT_URI = String(process.env.AUTH_REDIRECT_URI || "");
const AUTH_SCOPE = String(process.env.AUTH_SCOPE || "");
const H5_BASE_PATHS = normalizeStaticBasePaths(
  [process.env.H5_BASE_PATHS, process.env.H5_BASE_PATH, "/zhengqi-agent,/zhengqi-ai"]
    .filter(Boolean)
    .join(","),
);

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: DB_CONN_LIMIT,
  queueLimit: 0,
});

const PUBLIC_DIR = path.resolve(__dirname, "..", "h5-chatbot");
const LOG_DIR = path.resolve(__dirname, "logs");
const MESSAGE_LOG_PREFIX = "message";
const SERVER_LOG_PREFIX = "server";
const EMPTY_ALT_ANSWER = "抱歉，本次上游服务没有返回可展示的内容。请稍后重试，或换个问法再试一次。";
const ALT_RATE_LIMIT_ANSWER = "当前模型请求过于频繁或上下文过长，已触发上游限流。请稍后重试，或新建对话/缩短问题后再试。";

function normalizeStaticBasePaths(input) {
  return String(input || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (item === "/") return "";
      return `/${item.replace(/^\/+|\/+$/g, "")}`;
    })
    .filter((item, index, list) => list.indexOf(item) === index);
}

function stripStaticBasePath(pathname) {
  for (const basePath of H5_BASE_PATHS) {
    if (!basePath) continue;
    if (pathname === basePath || pathname === `${basePath}/`) return "/index.html";
    if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

/**
 * 确保日志目录存在。
 *
 * @returns {void}
 */
function ensureLogDirSync() {
  if (!fsSync.existsSync(LOG_DIR)) {
    fsSync.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * 以单行文本形式追加服务器日志。
 *
 * @param {string} filePath 日志文件路径。
 * @param {string} line 单行日志内容。
 * @returns {void}
 */
function appendLogLine(filePath, line) {
  try {
    ensureLogDirSync();
    fsSync.appendFileSync(filePath, `${line}\n`, "utf8");
  } catch {
    // ignore file logging failures to avoid affecting main flow
  }
}

/**
 * 返回按天切分的日志文件路径。
 *
 * @param {string} prefix 日志前缀。
 * @param {Date} [date] 目标日期。
 * @returns {string} 日志文件路径。
 */
function getDailyLogFilePath(prefix, date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return path.join(LOG_DIR, `${prefix}-${year}-${month}-${day}.log`);
}

/**
 * 以 JSON 行格式追加结构化日志。
 *
 * @param {string} prefix 日志前缀。
 * @param {object} payload 日志对象。
 * @returns {void}
 */
function appendJsonLog(prefix, payload) {
  appendLogLine(getDailyLogFilePath(prefix), JSON.stringify(payload));
}

function appendAuthUserInfoLog(payload) {
  appendJsonLog(SERVER_LOG_PREFIX, {
    ts: new Date().toISOString(),
    ...payload,
  });
}

function appendClientLog(payload) {
  appendJsonLog(SERVER_LOG_PREFIX, {
    ts: new Date().toISOString(),
    ...payload,
  });
}

/**
 * 启动时检查并补齐数据库缺失字段，兼容旧表结构。
 *
 * @returns {Promise<void>}
 */
async function ensureSchema() {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      `SELECT COUNT(*) AS count
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'messages'
         AND COLUMN_NAME = 'external_message_id'`,
      [DB_NAME],
    );
    const count = Number(rows?.[0]?.count || 0);
    if (!count) {
      await conn.execute(
        "ALTER TABLE messages ADD COLUMN external_message_id VARCHAR(128) DEFAULT NULL AFTER content",
      );
    }
  } finally {
    conn.release();
  }
}

/**
 * 对 fetch 做统一包装，补充网络不可达时的错误来源描述。
 *
 * @param {string} url 目标地址。
 * @param {object} options fetch 配置。
 * @param {string} label 错误来源标签。
 * @returns {Promise<Response>} fetch 响应对象。
 */
async function safeFetch(url, options, label) {
  try {
    return await fetch(url, options);
  } catch (err) {
    const reason = String(err?.cause?.code || err?.code || err?.message || err || "");
    throw new Error(`${label} unreachable: ${reason}`);
  }
}

/**
 * 返回所有接口共用的 CORS 响应头。
 *
 * @returns {Record<string, string>} CORS 响应头。
 */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * 计算 OAuth 授权地址。
 *
 * @returns {string} 授权地址。
 */
function getAuthAuthorizeUrlBase() {
  return buildAuthUrl(AUTH_AUTHORIZE_PATH);
}

/**
 * 计算 OAuth token 地址。
 *
 * @returns {string} token 地址。
 */
function getAuthTokenUrlBase() {
  return buildAuthUrl(AUTH_TOKEN_PATH);
}

/**
 * 计算 OAuth userinfo 地址。
 *
 * @returns {string} userinfo 地址。
 */
function getAuthUserInfoUrlBase() {
  return buildAuthUrl(AUTH_USERINFO_PATH);
}

/**
 * 根据环境变量和值形式构建完整认证 URL。
 *
 * @param {string} pathValue 原始路径或完整 URL。
 * @returns {string} 最终可请求的 URL。
 */
function buildAuthUrl(pathValue) {
  let raw = String(pathValue || "").trim();
  if (!raw) return "";
  const eqIdx = raw.indexOf("=");
  if (eqIdx > 0 && /^[A-Z0-9_]+$/i.test(raw.slice(0, eqIdx))) {
    raw = raw.slice(eqIdx + 1).trim();
  }
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!AUTH_SERVER_DOMAIN) return "";
  const base = AUTH_SERVER_DOMAIN.startsWith("http")
    ? AUTH_SERVER_DOMAIN
    : `https://${AUTH_SERVER_DOMAIN}`;
  const normalizedBase = base.replace(/\/+$/, "") + "/";
  const normalizedPath = raw.startsWith("/") ? raw.slice(1) : raw;
  return new URL(normalizedPath, normalizedBase).toString().replace(/\/$/, "");
}

/**
 * 构造反馈接口地址。
 *
 * @param {string} messageId 外部消息 ID。
 * @returns {string} 反馈接口地址。
 */
function getFeedbackUrl(messageId) {
  if (!FEEDBACK_BASE_URL) return "";
  const trimmed = String(messageId || "").trim();
  if (!trimmed) return "";
  return `${FEEDBACK_BASE_URL}/api/chat/message/${encodeURIComponent(
    trimmed,
  )}/feedback`;
}

function sendFeedbackAcceptedFallback(res, detail) {
  appendJsonLog(SERVER_LOG_PREFIX, {
    ts: new Date().toISOString(),
    event: "feedback:accepted-fallback",
    ...detail,
  });
  sendJson(res, 202, {
    ok: true,
    persisted: false,
    source: "feedback-fallback",
    message: "Feedback accepted locally; upstream feedback service is unavailable.",
  });
}

/**
 * 以 JSON 形式返回响应。
 *
 * @param {http.ServerResponse} res 响应对象。
 * @param {number} status HTTP 状态码。
 * @param {object} obj 返回对象。
 */
function sendJson(res, status, obj) {
  res.writeHead(status, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

/**
 * 尝试从上游原始错误内容中提取最有价值的错误明细。
 *
 * @param {string} raw 原始错误文本。
 * @returns {string} 提取后的错误明细。
 */
function extractErrorDetail(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    const data = JSON.parse(text);
    const detail = data?.error || data?.message || data?.detail || "";
    if (typeof detail === "string") {
      return detail.trim();
    }
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (item && typeof item === "object") {
            const loc = Array.isArray(item.loc) ? item.loc.join(".") : "";
            const msg = String(item.msg || item.message || "").trim();
            return loc && msg ? `${loc}: ${msg}` : msg || JSON.stringify(item);
          }
          return String(item || "").trim();
        })
        .filter(Boolean)
        .join("; ");
    }
    if (detail && typeof detail === "object") {
      return JSON.stringify(detail);
    }
    return String(detail || text).trim();
  } catch {
    return text;
  }
}

/**
 * 将 HTTP 状态码映射为中文错误分类。
 *
 * @param {number} status HTTP 状态码。
 * @returns {string} 中文错误分类。
 */
function formatStatusLabel(status) {
  if (status === 429) return "请求过于频繁";
  if (status === 400) return "请求参数错误";
  if (status === 401) return "认证失败";
  if (status === 403) return "无权限访问";
  if (status === 404) return "接口不存在";
  if (status === 408) return "请求超时";
  if (status === 409) return "数据冲突";
  if (status === 422) return "请求格式不正确";
  if (status >= 500) return "上游服务异常";
  return "请求失败";
}

/**
 * 统一格式化上游接口返回的错误结构。
 *
 * @param {string} source 错误来源。
 * @param {number} status HTTP 状态码。
 * @param {string} raw 上游原始错误文本。
 * @param {object} extra 额外字段。
 * @returns {object} 标准化错误对象。
 */
function isAltRateLimitError(text, status = 0) {
  const raw = String(text || "");
  if (status === 429) return true;
  return /USER_TPM_RATELIMITING|RateLimitError|TPM\s*超限|tokens?\s*后重试|too many requests|rate limit/i.test(raw);
}

function formatUpstreamError(source, status, raw, extra = {}) {
  const detail = extractErrorDetail(raw);
  if (isAltRateLimitError(`${detail}\n${raw}`, status)) {
    return {
      error: ALT_RATE_LIMIT_ANSWER,
      source,
      status,
      ...extra,
    };
  }
  const base = `${source}${formatStatusLabel(status)}（HTTP ${status}）`;
  return {
    error: detail ? `${base}：${detail}` : base,
    source,
    status,
    ...extra,
  };
}

/**
 * 将后端内部异常转换成更适合排障的中文提示。
 *
 * @param {Error & {code?: string}} err 异常对象。
 * @returns {string} 可读的中文错误描述。
 */
function formatInternalError(err) {
  const code = String(err?.code || "");
  if (code === "ER_BAD_FIELD_ERROR") {
    return "数据库字段缺失，请执行最新表结构迁移";
  }
  if (code === "ER_NO_SUCH_TABLE") {
    return "数据库表不存在，请初始化数据库";
  }
  if (code === "ER_ACCESS_DENIED_ERROR") {
    return "数据库认证失败，请检查 DB_USER / DB_PASSWORD";
  }
  if (code === "ECONNREFUSED") {
    return "数据库连接被拒绝，请确认 MySQL 已启动";
  }
  return String(err?.message || err || "Unknown server error");
}

/**
 * 根据静态文件扩展名推断 Content-Type。
 *
 * @param {string} filePath 文件路径。
 * @returns {string} Content-Type。
 */
function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

/**
 * 读取并解析 JSON 请求体。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @returns {Promise<object>} 解析后的 JSON 数据。
 */
async function readBodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw || "{}");
  } catch {
    const err = new Error("Invalid JSON body");
    err.statusCode = 400;
    throw err;
  }
}


/**
 * 归一化单条消息对象，兼容不同字段命名。
 *
 * @param {object} msg 原始消息对象。
 * @returns {object} 规范化后的消息对象。
 */
function normalizeMessage(msg) {
  const role = msg?.role === "assistant" ? "assistant" : "user";
  const content = String(msg?.content || "");
  const time = String(msg?.time || "");
  const id = msg?.id ?? msg?.messageId;
  const externalMessageId =
    msg?.externalMessageId ?? msg?.external_message_id ?? msg?.externalMessageID;
  const base = { role, content, time };
  if (id !== undefined && id !== null && String(id).trim()) {
    base.id = Number.isFinite(Number(id)) ? Number(id) : String(id);
  }
  if (externalMessageId !== undefined && externalMessageId !== null) {
    const trimmed = String(externalMessageId).trim();
    if (trimmed) {
      base.externalMessageId = trimmed;
    }
  }
  return base;
}

/**
 * 归一化单个会话对象，确保数据库同步所需字段齐全。
 *
 * @param {object} item 原始会话对象。
 * @returns {object} 规范化后的会话对象。
 */
function normalizeConversation(item) {
  const now = Date.now();
  const messages = Array.isArray(item?.messages) ? item.messages.map(normalizeMessage) : [];
  const platform = item?.platform === "agent" ? "agent" : "dify";
  return {
    id: String(item?.id || `conv-${now}`),
    title: String(item?.title || "新对话"),
    conversationId: String(item?.conversationId || ""),
    platform,
    messages: messages.slice(-80),
    createdAt: Number(item?.createdAt || now),
    updatedAt: Number(item?.updatedAt || now),
  };
}

/**
 * 归一化用户会话同步负载。
 *
 * @param {object} payload 原始同步负载。
 * @returns {{items: Array, activeId: string}} 规范化后的结果。
 */
function normalizeUserPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items.map(normalizeConversation) : [];
  const preferredActive = String(payload?.activeId || "");
  const activeId = items.some((c) => c.id === preferredActive) ? preferredActive : items[0]?.id || "";
  return { items, activeId };
}

const altTokenCache = { token: "", expMs: 0 };
let altTokenPromise = null;

/**
 * 计算线程创建接口地址，优先使用显式配置。
 *
 * @returns {string} 线程接口地址。
 */
function getAltThreadUrl() {
  if (ALT_THREAD_URL) return ALT_THREAD_URL;
  const marker = "/api/chat/agent/";
  const idx = ALT_API_URL.indexOf(marker);
  if (idx >= 0) {
    const base = ALT_API_URL.slice(0, idx);
    return `${base}/api/chat/thread`;
  }
  return "";
}

/**
 * 计算上游历史消息查询接口地址。
 *
 * @param {string} agentId 智能体 ID。
 * @param {string} threadId 会话线程 ID。
 * @returns {string} 历史消息接口地址。
 */
function getAltHistoryUrl(agentId, threadId) {
  const trimmedThreadId = String(threadId || "").trim();
  if (!trimmedThreadId) return "";
  const marker = "/api/chat/agent/";
  const idx = ALT_API_URL.indexOf(marker);
  if (idx < 0) return "";
  const base = ALT_API_URL.slice(0, idx);
  return `${base}/api/chat/agent/${encodeURIComponent(
    String(agentId || ALT_AGENT_ID).trim() || ALT_AGENT_ID,
  )}/history?thread_id=${encodeURIComponent(trimmedThreadId)}`;
}

/**
 * 判断消息 ID 是否已经是可直接提交给反馈接口的整数主键。
 *
 * @param {string} messageId 消息 ID。
 * @returns {boolean} 是否为整数 ID。
 */
function isIntegerMessageId(messageId) {
  return /^\d+$/.test(String(messageId || "").trim());
}

/**
 * 解析 JWT 中的 exp 字段。
 *
 * @param {string} token JWT 字符串。
 * @returns {number} 过期时间的 Unix 秒级时间戳。
 */
function parseJwtExp(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return 0;
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
  try {
    const json = Buffer.from(payload + pad, "base64").toString("utf8");
    const data = JSON.parse(json);
    return Number(data?.exp || 0);
  } catch {
    return 0;
  }
}

/**
 * 判断缓存中的上游 token 是否仍然有效。
 *
 * @returns {boolean} token 是否有效。
 */
function hasValidAltToken() {
  return altTokenCache.token && Date.now() < altTokenCache.expMs;
}

/**
 * 使用用户名密码向上游认证服务申请 token。
 *
 * @returns {Promise<string>} 上游 access token。
 */
async function requestAltToken() {
  if (!ALT_AUTH_URL || !ALT_AUTH_USERNAME || !ALT_AUTH_PASSWORD) {
    throw new Error("Missing ALT auth config");
  }
  const params = new URLSearchParams();
  params.set("grant_type", "password");
  params.set("username", ALT_AUTH_USERNAME);
  params.set("password", ALT_AUTH_PASSWORD);
  if (String(ALT_AUTH_SCOPE || "").trim()) {
    params.set("scope", ALT_AUTH_SCOPE);
  }
  if (String(ALT_AUTH_CLIENT_ID || "").trim()) {
    params.set("client_id", ALT_AUTH_CLIENT_ID);
  }
  if (String(ALT_AUTH_CLIENT_SECRET || "").trim()) {
    params.set("client_secret", ALT_AUTH_CLIENT_SECRET);
  }

  const res = await safeFetch(ALT_AUTH_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  }, "ALT auth service");

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "ALT token request failed");
  }

  const data = await res.json().catch(() => ({}));
  const token = String(data?.access_token || "");
  if (!token) throw new Error("ALT token missing in response");

  const exp = parseJwtExp(token);
  altTokenCache.token = token;
  altTokenCache.expMs = exp ? exp * 1000 - 30_000 : Date.now() + 50 * 60 * 1000;
  return token;
}

/**
 * 获取可用的上游认证 token，优先使用缓存，其次动态申请。
 *
 * @returns {Promise<string>} 上游 access token。
 */
async function getAltAuthToken() {
  if (ALT_AUTH_URL) {
    if (hasValidAltToken()) return altTokenCache.token;
    if (altTokenPromise) return altTokenPromise;
    altTokenPromise = requestAltToken().finally(() => {
      altTokenPromise = null;
    });
    return altTokenPromise;
  }
  if (!ALT_API_TOKEN) {
    throw new Error("Missing ALT_API_TOKEN or ALT_AUTH_URL env var on server");
  }
  return ALT_API_TOKEN;
}

/**
 * 从数据库读取指定用户的完整会话及消息列表。
 *
 * @param {string} userKey 用户唯一标识。
 * @returns {Promise<{items: Array, activeId: string}>} 会话列表和激活会话 ID。
 */
async function fetchUserConversations(userKey) {
  const conn = await pool.getConnection();
  try {
    const [userRows] = await conn.execute(
      "SELECT id, active_conversation_key FROM users WHERE user_key = ?",
      [userKey],
    );
    if (!userRows.length) {
      return { items: [], activeId: "" };
    }

    const userId = userRows[0].id;
    const activeKey = String(userRows[0].active_conversation_key || "");
    const [convRows] = await conn.execute(
      "SELECT id, conversation_key, title, platform, dify_conversation_id, created_at_ms, updated_at_ms FROM conversations WHERE user_id = ? ORDER BY updated_at_ms DESC",
      [userId],
    );

    if (!convRows.length) {
      return { items: [], activeId: "" };
    }

    const convIds = convRows.map((row) => row.id);
    const placeholders = convIds.map(() => "?").join(",");
    const [msgRows] = await conn.query(
      `SELECT id, conversation_id, role, content, time_label, position, external_message_id FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY conversation_id, position`,
      convIds,
    );

    const msgMap = new Map();
    for (const row of msgRows) {
      const list = msgMap.get(row.conversation_id) || [];
      list.push({
        id: row.id,
        role: row.role === "assistant" ? "assistant" : "user",
        content: String(row.content || ""),
        time: String(row.time_label || ""),
        externalMessageId: row.external_message_id
          ? String(row.external_message_id)
          : "",
      });
      msgMap.set(row.conversation_id, list);
    }

    const items = convRows.map((row) =>
      normalizeConversation({
        id: String(row.conversation_key || ""),
        title: String(row.title || ""),
        conversationId: String(row.dify_conversation_id || ""),
        platform: row.platform === "agent" ? "agent" : "dify",
        messages: msgMap.get(row.id) || [],
        createdAt: Number(row.created_at_ms || Date.now()),
        updatedAt: Number(row.updated_at_ms || Date.now()),
      }),
    );

    const activeId = items.some((c) => c.id === activeKey) ? activeKey : items[0]?.id || "";
    return { items, activeId };
  } finally {
    conn.release();
  }
}

/**
 * 将用户会话列表整体写回数据库，并返回新生成的消息 ID 映射。
 *
 * @param {string} userKey 用户唯一标识。
 * @param {object} payload 会话同步负载。
 * @returns {Promise<{messageIds: Record<string, Array<number>>}>} 消息 ID 映射。
 */
async function syncUserConversations(userKey, payload) {
  const normalized = normalizeUserPayload(payload);
  const messageIds = {};
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [userResult] = await conn.execute(
      "INSERT INTO users (user_key, active_conversation_key) VALUES (?, ?) ON DUPLICATE KEY UPDATE active_conversation_key = VALUES(active_conversation_key), id = LAST_INSERT_ID(id)",
      [userKey, normalized.activeId || null],
    );
    const userId = userResult.insertId;

    const [existingRows] = await conn.execute(
      "SELECT id, conversation_key FROM conversations WHERE user_id = ?",
      [userId],
    );
    const existingMap = new Map(existingRows.map((row) => [row.conversation_key, row.id]));
    const keepKeys = new Set();

    for (const conv of normalized.items) {
      const convKey = String(conv.id || "");
      keepKeys.add(convKey);
      const title = String(conv.title || "");
      const platform = conv.platform === "agent" ? "agent" : "dify";
      const difyConversationId = conv.conversationId ? String(conv.conversationId) : null;
      const createdAtMs = Number(conv.createdAt || Date.now());
      const updatedAtMs = Number(conv.updatedAt || Date.now());

      let convId = existingMap.get(convKey);
      if (convId) {
        await conn.execute(
          "UPDATE conversations SET title = ?, platform = ?, dify_conversation_id = ?, created_at_ms = ?, updated_at_ms = ? WHERE id = ?",
          [title, platform, difyConversationId, createdAtMs, updatedAtMs, convId],
        );
      } else {
        const [insertResult] = await conn.execute(
          "INSERT INTO conversations (user_id, conversation_key, title, platform, dify_conversation_id, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [userId, convKey, title, platform, difyConversationId, createdAtMs, updatedAtMs],
        );
        convId = insertResult.insertId;
        existingMap.set(convKey, convId);
      }

      await conn.execute("DELETE FROM messages WHERE conversation_id = ?", [convId]);
      const messages = Array.isArray(conv.messages) ? conv.messages.map(normalizeMessage) : [];
      if (messages.length) {
        const values = messages.map((msg, idx) => [
          convId,
          msg.role === "assistant" ? "assistant" : "user",
          String(msg.content || ""),
          String(msg.time || ""),
          idx,
          updatedAtMs,
          msg.externalMessageId ? String(msg.externalMessageId) : null,
        ]);
        await conn.query(
          "INSERT INTO messages (conversation_id, role, content, time_label, position, created_at_ms, external_message_id) VALUES ?",
          [values],
        );
      }
      const [idRows] = await conn.execute(
        "SELECT id FROM messages WHERE conversation_id = ? ORDER BY position",
        [convId],
      );
      messageIds[convKey] = idRows.map((row) => row.id);
    }

    if (keepKeys.size) {
      const keys = Array.from(keepKeys);
      const placeholders = keys.map(() => "?").join(",");
      await conn.execute(
        `DELETE FROM conversations WHERE user_id = ? AND conversation_key NOT IN (${placeholders})`,
        [userId, ...keys],
      );
    } else {
      await conn.execute("DELETE FROM conversations WHERE user_id = ?", [userId]);
    }

    await conn.commit();
    return { messageIds };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 转发 Dify `/chat-messages` 接口，并保持流式响应能力。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @returns {Promise<void>}
 */
async function handleChatMessages(req, res) {
  if (!DIFY_API_KEY) {
    sendJson(res, 500, { error: "Missing DIFY_API_KEY env var on server" });
    return;
  }

  const body = await readBodyJson(req);
  const upstreamUrl = `${DIFY_BASE_URL}/chat-messages`;

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const upstreamRes = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DIFY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  const contentType = upstreamRes.headers.get("content-type") || "application/octet-stream";
  const isSse = contentType.includes("text/event-stream");

  res.writeHead(upstreamRes.status, {
    ...corsHeaders(),
    "Content-Type": contentType,
    ...(isSse ? { "Cache-Control": "no-cache" } : null),
  });
  res.flushHeaders?.();

  if (!upstreamRes.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamRes.body).pipe(res);
}

/**
 * 处理会话列表读取接口。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @param {URL} url 已解析的请求 URL。
 * @returns {Promise<void>}
 */
async function handleConversationsList(req, res, url) {
  const userId = String(url.searchParams.get("userId") || "");
  if (!userId) {
    sendJson(res, 400, { error: "Missing userId" });
    return;
  }

  const data = await fetchUserConversations(userId);
  sendJson(res, 200, { items: data.items || [], activeId: data.activeId || "" });
}

/**
 * 处理会话列表同步接口。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @returns {Promise<void>}
 */
async function handleConversationsSync(req, res) {
  const body = await readBodyJson(req);
  const userId = String(body?.userId || "");
  if (!userId) {
    sendJson(res, 400, { error: "Missing userId" });
    return;
  }

  const result = await syncUserConversations(userId, body);
  sendJson(res, 200, { ok: true, messageIds: result.messageIds || {} });
}

/**
 * 根据本地消息行 ID 返回消息元信息。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @param {URL} url 已解析的请求 URL。
 * @returns {Promise<void>}
 */
async function handleMessageMeta(req, res, url) {
  const messageId = Number.parseInt(String(url.searchParams.get("messageId") || ""), 10);
  if (!Number.isFinite(messageId) || messageId <= 0) {
    sendJson(res, 400, { error: "Missing messageId" });
    return;
  }

  const [rows] = await pool.execute(
    "SELECT id, role, conversation_id, external_message_id FROM messages WHERE id = ? LIMIT 1",
    [messageId],
  );
  const row = rows?.[0];
  if (!row) {
    sendJson(res, 404, { error: "Message not found" });
    return;
  }

  sendJson(res, 200, {
    id: Number(row.id),
    role: String(row.role || ""),
    conversationId: Number(row.conversation_id || 0),
    externalMessageId: row.external_message_id ? String(row.external_message_id) : "",
  });
}

/**
 * 基于本地消息表与上游 history 接口，将流式运行 ID 映射为上游数据库消息主键。
 *
 * @param {string} messageId 当前持有的消息 ID，可能为整数或 lc_run-- 字符串。
 * @param {string} token 上游 Bearer Token。
 * @param {string} cookieHeader 原始 Cookie 头。
 * @returns {Promise<string>} 可用于反馈接口的整数消息 ID；若无法映射则返回原值。
 */
async function resolveFeedbackMessageId(messageId, token, cookieHeader = "") {
  const trimmedId = String(messageId || "").trim();
  if (!trimmedId) return "";
  if (isIntegerMessageId(trimmedId)) return trimmedId;

  const [rows] = await pool.execute(
    `SELECT m.id AS local_message_id, c.dify_conversation_id AS thread_id
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.external_message_id = ?
     ORDER BY m.id DESC
     LIMIT 1`,
    [trimmedId],
  );
  const row = rows?.[0];
  const threadId = String(row?.thread_id || "").trim();
  if (!threadId) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:map:miss-local-thread",
      externalMessageId: trimmedId,
    });
    return trimmedId;
  }

  const historyUrl = getAltHistoryUrl(ALT_AGENT_ID, threadId);
  if (!historyUrl) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:map:miss-history-url",
      externalMessageId: trimmedId,
      threadId,
    });
    return trimmedId;
  }

  const upstreamRes = await safeFetch(
    historyUrl,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
    },
    "ALT history service",
  );

  const text = await upstreamRes.text().catch(() => "");
  if (!upstreamRes.ok) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:map:history-error",
      externalMessageId: trimmedId,
      threadId,
      historyUrl,
      status: upstreamRes.status,
      responseText: text,
    });
    return trimmedId;
  }

  let data = {};
  try {
    data = JSON.parse(text || "{}");
  } catch {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:map:history-invalid-json",
      externalMessageId: trimmedId,
      threadId,
      historyUrl,
      responseText: text,
    });
    return trimmedId;
  }

  const history = Array.isArray(data?.history) ? data.history : [];
  const matched = history.find((item) => {
    const extraId = String(item?.extra_metadata?.id || "").trim();
    return extraId && extraId === trimmedId;
  });
  const resolvedId = String(matched?.id || "").trim();
  if (resolvedId && isIntegerMessageId(resolvedId)) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:map:resolved",
      externalMessageId: trimmedId,
      resolvedMessageId: resolvedId,
      threadId,
      localMessageId: Number(row?.local_message_id || 0),
    });
    return resolvedId;
  }

  appendJsonLog(SERVER_LOG_PREFIX, {
    ts: new Date().toISOString(),
    event: "feedback:map:not-found",
    externalMessageId: trimmedId,
    threadId,
    historyCount: history.length,
  });
  return trimmedId;
}

/**
 * 从上游聊天响应对象中提取最终答案文本。
 *
 * @param {object|string} data 上游响应对象或字符串。
 * @returns {string} 提取到的答案文本。
 */
function extractAltAnswer(data) {
  if (typeof data === "string") return isAltRateLimitError(data) ? ALT_RATE_LIMIT_ANSWER : data;
  if (!data || typeof data !== "object") return "";
  const errorText = extractAltError(data);
  if (errorText) return errorText;
  const candidates = [
    data.response,
    data.answer,
    data.message,
    data.content,
    data.text,
    data.result,
    data.output,
    data.msg?.content,
    data.data?.answer,
    data.data?.message,
    data.data?.content,
    data.data?.text,
    data.data?.result,
    data.data?.output,
    data.data?.response,
    data.data?.reply,
    data.choices?.[0]?.message?.content,
    data.data?.choices?.[0]?.message?.content,
  ];
  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) {
      const cleaned = filterAltText({ toolBlock: false, toolDump: false }, item);
      if (isAltRateLimitError(cleaned)) return ALT_RATE_LIMIT_ANSWER;
      if (cleaned.trim()) return cleaned;
    }
  }
  if (String(data.status || "") === "finished") return EMPTY_ALT_ANSWER;
  return "";
}

/**
 * 从上游聊天响应对象中提取错误文本。
 *
 * @param {object} data 上游响应对象。
 * @returns {string} 错误文本。
 */
function extractAltError(data) {
  if (!data || typeof data !== "object") return "";
  const status = String(data.status || "");
  if (status !== "error") return "";
  const msg =
    data.error_message ||
    data.errorMessage ||
    data.message ||
    data.msg?.content ||
    data.msg?.error ||
    data.error?.message ||
    data.error?.msg;
  if (isAltRateLimitError(msg, Number(data.status_code || data.code || data.error?.code || 0))) {
    return ALT_RATE_LIMIT_ANSWER;
  }
  return typeof msg === "string" ? msg.trim() : "";
}

/**
 * 去除上游响应中的思维链或分析标签。
 *
 * @param {string} text 原始文本。
 * @returns {string} 清洗后的文本。
 */
function stripAltText(text) {
  let out = String(text || "");
  if (!out) return "";
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "");
  out = out.replace(/^\s*(思考|Thought|Reasoning)\s*[:：].*\n?/i, "");
  return out;
}

/**
 * 将上游原始负载输出到日志，便于排障。
 *
 * @param {object} payload 上游负载对象。
 */
function logAltRawPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  try {
    // eslint-disable-next-line no-console
    console.log("[ALT RAW]", JSON.stringify(payload));
  } catch {
    // eslint-disable-next-line no-console
    console.log("[ALT RAW]", payload);
  }
}

/**
 * 从上游负载中提取外部消息 ID。
 *
 * @param {object} payload 上游负载对象。
 * @returns {string} 外部消息 ID。
 */
function extractAltMessageId(payload) {
  if (!payload || typeof payload !== "object") return "";
  const metadata = payload.metadata || payload.meta || {};
  const msg = payload.msg || {};
  const msgMetadata = msg.metadata || {};
  const raw =
    metadata.message_id ??
    metadata.messageId ??
    metadata.messageID ??
    payload.message_id ??
    payload.messageId ??
    msg.message_id ??
    msg.messageId ??
    msg.id ??
    msgMetadata.message_id ??
    msgMetadata.messageId ??
    msgMetadata.messageID;
  if (raw === undefined || raw === null || raw === "") return "";
  return String(raw);
}

/**
 * 为流式请求生成简短诊断 ID，便于串联一次完整会话。
 *
 * @returns {string} 请求诊断 ID。
 */
function createAltStreamDiagId() {
  return `alt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 安全提取对象的键名列表，避免日志中输出过大对象。
 *
 * @param {unknown} value 待检查值。
 * @returns {string[]} 键名数组。
 */
function listObjectKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value);
}

/**
 * 记录单次聊天消息的精简摘要日志。
 *
 * @param {string} requestId 本次流式请求 ID。
 * @param {string} status 消息处理状态。
 * @param {object} detail 附加字段。
 * @returns {void}
 */
function logMessageSummary(requestId, status, detail = {}) {
  const entry = {
    ts: new Date().toISOString(),
    requestId,
    status,
    detail,
  };
  appendJsonLog(MESSAGE_LOG_PREFIX, entry);
}

/**
 * 汇总最终消息日志里需要保留的上游关键信息。
 *
 * @param {object} payload 上游事件负载。
 * @returns {object|null} 精简后的消息信息。
 */
function summarizeAltPayloadForMessage(payload) {
  if (!payload || typeof payload !== "object") return null;
  const metadata = payload?.metadata || payload?.meta || {};
  const msg = payload?.msg || {};
  return {
    payloadKeys: listObjectKeys(payload),
    msgType: String(msg?.type || ""),
    role: String(msg?.role || ""),
    status: String(payload?.status || ""),
    extractedMessageId: extractAltMessageId(payload) || "",
    msgId: msg?.id ?? msg?.message_id ?? msg?.messageId ?? null,
    metadataKeys: listObjectKeys(metadata),
  };
}

/**
 * 清理流式响应中的工具调用 XML 片段。
 *
 * @param {object} state 文本过滤状态。
 * @param {string} text 原始文本。
 * @returns {string} 清洗后的文本。
 */
function stripToolBlocks(state, text) {
  let out = "";
  let rest = String(text || "");
  if (!rest) return "";

  while (rest) {
    if (state.toolBlock) {
      const endMatch = rest.match(/<\/tool_call[^>]*>/i);
      if (!endMatch) {
        return "";
      }
      const endIdx = endMatch.index ?? -1;
      if (endIdx >= 0) {
        rest = rest.slice(endIdx + endMatch[0].length);
      } else {
        return "";
      }
      state.toolBlock = false;
      continue;
    }

    const startMatch = rest.match(/<tool_call[^>]*>/i);
    if (!startMatch) {
      out += rest;
      break;
    }
    const startIdx = startMatch.index ?? -1;
    if (startIdx > -1) {
      out += rest.slice(0, startIdx);
      rest = rest.slice(startIdx + startMatch[0].length);
      state.toolBlock = true;
      continue;
    }
    break;
  }

  return out;
}

/**
 * 清理知识库或工具调用产生的大段结构化输出。
 *
 * @param {object} state 文本过滤状态。
 * @param {string} text 原始文本。
 * @returns {string} 清洗后的文本。
 */
function stripToolDump(state, text) {
  const raw = String(text || "");
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  const kept = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const shouldStartDump =
      /knowledge\s+graph\s+data/i.test(trimmed) ||
      /document\s+chunks/i.test(trimmed) ||
      /reference\s+document\s+list/i.test(trimmed);

    if (shouldStartDump) {
      state.toolDump = true;
      continue;
    }

    const isDumpLine =
      !trimmed ||
      trimmed.startsWith("```") ||
      trimmed.startsWith("{") ||
      trimmed.startsWith("}") ||
      trimmed.startsWith("[") ||
      trimmed.startsWith("]") ||
      /^https?:\/\//i.test(trimmed) ||
      /^\[\d+\]\s*https?:\/\//i.test(trimmed);

    if (state.toolDump) {
      if (isDumpLine) {
        continue;
      }
      state.toolDump = false;
    }

    kept.push(line);
  }

  return kept.join("\n");
}

/**
 * 对上游文本做统一过滤，去除工具调用和无关调试信息。
 *
 * @param {object} state 文本过滤状态。
 * @param {string} text 原始文本。
 * @returns {string} 清洗后的文本。
 */
function filterAltText(state, text) {
  let out = stripAltText(text);
  out = stripToolBlocks(state, out);
  out = out.replace(/<\/?tool_call[^>]*>/gi, "");
  out = out.replace(/<\/?tool[^>]*>/gi, "");
  out = out.replace(/^\s*tool_call.*$/gim, "");
  out = stripToolDump(state, out);
  return out;
}

/**
 * 判断当前上游负载是否主要包含工具调用信息。
 *
 * @param {object} payload 上游负载对象。
 * @returns {boolean} 是否为工具调用负载。
 */
function hasToolPayload(payload) {
  const msg = payload?.msg || {};
  const toolCalls = msg.tool_calls || payload.tool_calls;
  const toolChunks = msg.tool_call_chunks || payload.tool_call_chunks;
  const invalidCalls = msg.invalid_tool_calls || payload.invalid_tool_calls;
  const extraTools = msg.additional_kwargs?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length) return true;
  if (Array.isArray(toolChunks) && toolChunks.length) return true;
  if (Array.isArray(invalidCalls) && invalidCalls.length) return true;
  if (Array.isArray(extraTools) && extraTools.length) return true;
  return false;
}

function parseToolArgs(rawArgs) {
  if (!rawArgs) return {};
  if (typeof rawArgs === "object") return rawArgs;
  if (typeof rawArgs !== "string") return {};
  try {
    return JSON.parse(rawArgs);
  } catch {
    return {};
  }
}

function collectAltToolCalls(payload) {
  const msg = payload?.msg || {};
  const groups = [
    msg.tool_calls,
    payload.tool_calls,
    msg.tool_call_chunks,
    payload.tool_call_chunks,
    msg.invalid_tool_calls,
    payload.invalid_tool_calls,
    msg.additional_kwargs?.tool_calls,
  ];
  return groups.flatMap((group) => (Array.isArray(group) ? group : []));
}

function formatAltToolProgress(name, args = {}, completed = false) {
  const toolName = String(name || "").trim();
  const kbName = String(args.kb_name || args.kbName || "").trim();
  const queryText = String(args.query_text || args.query || "").trim();
  const suffix = queryText ? `，关键词：${queryText.slice(0, 40)}` : "";
  if (toolName === "list_kbs") return completed ? "已获取可用知识库，正在选择检索范围" : "正在获取可用知识库";
  if (toolName === "query_kb") {
    if (completed) return "已完成知识库检索，正在整理答案";
    return kbName ? `正在检索知识库「${kbName}」${suffix}` : `正在检索知识库${suffix}`;
  }
  if (toolName === "get_mindmap") {
    if (completed) return "已读取知识库结构，正在整理检索思路";
    return kbName ? `正在读取知识库「${kbName}」的结构` : "正在读取知识库结构";
  }
  if (toolName) return completed ? "工具调用完成，正在整理答案" : `正在调用工具：${toolName}`;
  return "";
}

function extractAltProgress(payload) {
  if (!payload || typeof payload !== "object") return "";
  const status = String(payload.status || "");
  if (status === "init") return "正在准备问题上下文";
  if (status === "agent_state") return "正在同步检索状态";

  const msg = payload.msg || {};
  if (String(msg.type || "").toLowerCase() === "tool" || String(msg.role || "") === "tool") {
    return formatAltToolProgress(msg.name || msg.tool, {}, true);
  }

  for (const call of collectAltToolCalls(payload)) {
    const name = call?.name || call?.function?.name || call?.tool || "";
    const args = parseToolArgs(call?.args ?? call?.arguments ?? call?.function?.arguments);
    const progress = formatAltToolProgress(name, args, false);
    if (progress) return progress;
  }

  return "";
}

function writeAltProgress(res, state, payload) {
  const progress = extractAltProgress(payload);
  if (!progress || progress === state.lastProgress) return;
  state.lastProgress = progress;
  res.write(`data: ${JSON.stringify({ event: "progress", message: progress })}\n\n`);
}

/**
 * 处理新增流式分片，并返回真正需要输出给前端的增量文本。
 *
 * @param {object} state 流式解析状态。
 * @param {string} chunk 当前分片。
 * @returns {string} 过滤后的增量文本。
 */
function appendAltStream(state, chunk) {
  if (chunk === "") return "";

  let deltaRaw = chunk;
  if (state.rawStreamedText && chunk.startsWith(state.rawStreamedText)) {
    deltaRaw = chunk.slice(state.rawStreamedText.length);
    state.rawStreamedText = chunk;
  } else {
    state.rawStreamedText += chunk;
  }

  state.lastChunk = chunk;
  const delta = filterAltText(state, deltaRaw);
  if (delta) {
    state.streamedText += delta;
  }
  return delta;
}

/**
 * 消费单条上游 JSON 负载，更新当前流式解析状态。
 *
 * @param {object} state 流式解析状态。
 * @param {object} payload 上游负载对象。
 */
function consumeAltPayload(state, payload) {
  if (!payload || typeof payload !== "object") return;
  state.hasParsed = true;
  const externalMessageId = extractAltMessageId(payload);
  if (externalMessageId) {
    state.externalMessageId = externalMessageId;
  }
  if (hasToolPayload(payload)) {
    return;
  }
  const errorText = extractAltError(payload);
  if (errorText) {
    state.finalText = errorText;
    state.lastPayload = payload;
    return;
  }
  const response = typeof payload.response === "string" ? payload.response : "";
  const msgContent = typeof payload.msg?.content === "string" ? payload.msg.content : "";
  const msgType = String(payload.msg?.type || "");
  const status = String(payload.status || "");
  const role = String(payload.msg?.role || "");
  const msgTypeLower = msgType.toLowerCase();
  if (payload.response === null && !msgContent) {
    return;
  }
  state.lastPayload = payload;

  const hasChunkHint = msgType.includes("Chunk") || status === "loading";
  if (
    msgTypeLower.includes("human") ||
    msgTypeLower.includes("tool") ||
    msgTypeLower.includes("function") ||
    role === "user" ||
    role === "tool"
  ) {
    return;
  }
  const rawChunk = msgContent !== "" ? msgContent : response !== "" ? response : "";
  if (hasChunkHint) {
    if (!rawChunk) return;
    appendAltStream(state, rawChunk);
    return;
  }

  const cleaned = filterAltText(state, rawChunk);
  if (!cleaned) return;
  if (response !== "") {
    state.finalText = cleaned;
    return;
  }

  if (msgContent !== "") {
    state.finalText = cleaned;
  }
}

/**
 * 尝试解析一行上游流式文本，并合并到解析状态。
 *
 * @param {object} state 流式解析状态。
 * @param {string} line 单行文本。
 */
function tryParseAltLine(state, line) {
  let text = String(line || "").trim();
  if (!text) return;
  if (text.startsWith("data:")) {
    text = text.slice(5).trim();
  }
  if (!text || text === "[DONE]") return;

  try {
    const obj = JSON.parse(text);
    logAltRawPayload(obj);
    consumeAltPayload(state, obj);
  } catch {
    // ignore non-JSON lines
  }
}

/**
 * 将上游聊天响应流解析成完整答案、原始负载和外部消息 ID。
 *
 * @param {Response} upstreamRes 上游响应对象。
 * @returns {Promise<{answer: string, raw: object|null, externalMessageId: string}>} 解析结果。
 */
async function readAltResponse(upstreamRes) {
  const reader = upstreamRes.body?.getReader();
  if (!reader) {
    return { answer: "", raw: null, externalMessageId: "" };
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let rawText = "";
  const state = {
    streamedText: "",
    rawStreamedText: "",
    finalText: "",
    lastPayload: null,
    hasParsed: false,
    lastChunk: "",
    toolBlock: false,
    toolDump: false,
    externalMessageId: "",
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    rawText += chunk;
    buffer += chunk;
    buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      tryParseAltLine(state, line);
    }
  }

  if (buffer.trim()) {
    tryParseAltLine(state, buffer);
  }

  let answer = state.finalText || state.streamedText;
  if (state.streamedText && state.streamedText.length > (state.finalText || "").length) {
    answer = state.streamedText;
  }
  if (!answer && state.lastPayload) {
    answer = extractAltAnswer(state.lastPayload);
  }

  if (!answer && !state.hasParsed && rawText.trim()) {
    try {
      const obj = JSON.parse(rawText);
      answer = extractAltAnswer(obj);
      return {
        answer,
        raw: obj,
        externalMessageId: extractAltMessageId(obj) || state.externalMessageId,
      };
    } catch {
      // ignore
    }
  }

  return {
    answer,
    raw: state.lastPayload,
    externalMessageId: state.externalMessageId || "",
  };
}

/**
 * 处理阻塞式聊天接口，向上游发送请求并返回完整答案。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @returns {Promise<void>}
 */
async function handleAltChat(req, res) {
  if (!ALT_API_URL) {
    sendJson(res, 500, { error: "服务端缺少 ALT_API_URL 配置", source: "server-config" });
    return;
  }
  let token = "";
  try {
    token = await getAltAuthToken();
  } catch (err) {
    sendJson(res, 500, { error: `上游认证失败：${String(err?.message || err)}`, source: "alt-auth" });
    return;
  }

  const body = await readBodyJson(req);
  const payload = {
    query: String(body?.query || ""),
    config: typeof body?.config === "object" && body?.config ? body.config : {},
    meta: typeof body?.meta === "object" && body?.meta ? body.meta : {},
  };

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const upstreamRes = await safeFetch(ALT_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }, "ALT chat service");

  if (!upstreamRes.ok) {
    const txt = await upstreamRes.text().catch(() => "");
    sendJson(res, upstreamRes.status, formatUpstreamError("聊天上游", upstreamRes.status, txt));
    return;
  }

  const result = await readAltResponse(upstreamRes);
  const answer = String(result.answer || "").trim() ? result.answer : EMPTY_ALT_ANSWER;
  sendJson(res, 200, {
    answer,
    raw: result.raw || null,
    externalMessageId: result.externalMessageId || "",
  });
}

/**
 * 从上游负载中提取当前可直接输出的文本分片。
 *
 * @param {object} payload 上游负载对象。
 * @returns {string|null} 文本分片或 null。
 */
function extractAltChunk(payload) {
  if (!payload || typeof payload !== "object") return null;
  const errorText = extractAltError(payload);
  if (errorText) return errorText;
  const msgType = String(payload.msg?.type || "");
  const status = String(payload.status || "");
  const role = String(payload.msg?.role || "");
  const msgTypeLower = msgType.toLowerCase();
  if (
    msgTypeLower.includes("human") ||
    msgTypeLower.includes("tool") ||
    msgTypeLower.includes("function") ||
    role === "user" ||
    role === "tool"
  ) {
    return null;
  }
  if (hasToolPayload(payload)) return null;
  if (!(msgType.includes("Chunk") || status === "loading")) return null;
  const msgContent = typeof payload.msg?.content === "string" ? payload.msg.content : "";
  const response = typeof payload.response === "string" ? payload.response : "";
  if (payload.response === null && msgContent === "") return null;
  const raw = msgContent !== "" ? msgContent : response !== "" ? response : "";
  if (isAltRateLimitError(raw)) return ALT_RATE_LIMIT_ANSWER;
  if (raw !== "") return raw;
  return null;
}

/**
 * 在流式结束前尝试捕获最终答案文本。
 *
 * @param {object} state 流式解析状态。
 * @param {object} payload 上游负载对象。
 */
function captureAltFinalText(state, payload) {
  if (!payload || typeof payload !== "object") return;
  if (state.finalText) return;
  if (hasToolPayload(payload)) return;
  const msgType = String(payload.msg?.type || "");
  const status = String(payload.status || "");
  const role = String(payload.msg?.role || "");
  const msgTypeLower = msgType.toLowerCase();
  const isChunk = msgType.includes("Chunk") || status === "loading";
  if (isChunk) return;
  if (
    msgTypeLower.includes("human") ||
    msgTypeLower.includes("tool") ||
    msgTypeLower.includes("function") ||
    role === "user" ||
    role === "tool"
  ) {
    return;
  }
  const msgContent = typeof payload.msg?.content === "string" ? payload.msg.content : "";
  if (payload.response === null && !msgContent) return;
  const text = extractAltAnswer(payload);
  if (text) state.finalText = text;
}

/**
 * 处理流式聊天接口，并将上游结果转成前端可消费的 SSE。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @returns {Promise<void>}
 */
async function handleAltChatStream(req, res) {
  if (!ALT_API_URL) {
    sendJson(res, 500, { error: "服务端缺少 ALT_API_URL 配置", source: "server-config" });
    return;
  }
  const requestId = createAltStreamDiagId();
  let token = "";
  try {
    token = await getAltAuthToken();
  } catch (err) {
    logMessageSummary(requestId, "auth-error", {
      error: String(err?.message || err || ""),
    });
    sendJson(res, 500, { error: `上游认证失败：${String(err?.message || err)}`, source: "alt-auth" });
    return;
  }

  const body = await readBodyJson(req);
  const payload = {
    query: String(body?.query || ""),
    config: typeof body?.config === "object" && body?.config ? body.config : {},
    meta: typeof body?.meta === "object" && body?.meta ? body.meta : {},
  };
  const threadIdForLog = String(payload?.config?.thread_id || payload?.config?.threadId || "");

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  const upstreamRes = await safeFetch(ALT_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }, "ALT chat service");
  if (!upstreamRes.ok) {
    const txt = await upstreamRes.text().catch(() => "");
    logMessageSummary(requestId, "upstream-error", {
      threadId: threadIdForLog,
      queryLength: payload.query.length,
      status: upstreamRes.status,
      bodyPreview: txt.slice(0, 300),
    });
    sendJson(res, upstreamRes.status, formatUpstreamError("聊天上游", upstreamRes.status, txt));
    return;
  }

  res.writeHead(200, {
    ...corsHeaders(),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  const reader = upstreamRes.body?.getReader();
  if (!reader) {
    const txt = await upstreamRes.text().catch(() => "");
    res.write(`data: ${JSON.stringify({ event: "message", answer: txt })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  const state = {
    requestId,
    streamedText: "",
    rawStreamedText: "",
    lastChunk: "",
    toolBlock: false,
    toolDump: false,
    errorSent: false,
    externalMessageId: "",
    metaSent: false,
    finalText: "",
    lastPayload: null,
    lastProgress: "",
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const text = line.trim();
      if (!text) continue;
      try {
        const payloadObj = JSON.parse(text.startsWith("data:") ? text.slice(5).trim() : text);
        logAltRawPayload(payloadObj);
        state.lastPayload = payloadObj;
        writeAltProgress(res, state, payloadObj);
        const externalMessageId = extractAltMessageId(payloadObj);
        if (externalMessageId) {
          state.externalMessageId = externalMessageId;
          if (!state.metaSent) {
            state.metaSent = true;
            res.write(
              `data: ${JSON.stringify({
                event: "meta",
                messageId: externalMessageId,
              })}\n\n`,
            );
          }
        }
        const errorText = extractAltError(payloadObj);
        if (errorText) {
          if (!state.errorSent) {
            state.errorSent = true;
            res.write(`data: ${JSON.stringify({ event: "message", answer: errorText })}\n\n`);
          }
          continue;
        }
        const chunk = extractAltChunk(payloadObj);
        if (chunk !== null) {
          const delta = appendAltStream(state, chunk);
          if (delta) {
            res.write(`data: ${JSON.stringify({ event: "message", answer: delta })}\n\n`);
          } else if (chunk && !state.toolBlock && !state.toolDump) {
            state.streamedText += chunk;
            res.write(
              `data: ${JSON.stringify({ event: "message", answer: chunk })}\n\n`,
            );
          }
        } else {
          captureAltFinalText(state, payloadObj);
        }
      } catch {
        // ignore
      }
    }
  }

  if (buffer.trim()) {
    try {
      const payloadObj = JSON.parse(buffer.startsWith("data:") ? buffer.slice(5).trim() : buffer);
      logAltRawPayload(payloadObj);
      state.lastPayload = payloadObj;
      writeAltProgress(res, state, payloadObj);
      const externalMessageId = extractAltMessageId(payloadObj);
      if (externalMessageId) {
        state.externalMessageId = externalMessageId;
        if (!state.metaSent) {
          state.metaSent = true;
          res.write(
            `data: ${JSON.stringify({
              event: "meta",
              messageId: externalMessageId,
            })}\n\n`,
          );
        }
      }
      const errorText = extractAltError(payloadObj);
      if (errorText) {
        if (!state.errorSent) {
          state.errorSent = true;
          res.write(`data: ${JSON.stringify({ event: "message", answer: errorText })}\n\n`);
        }
      } else {
        const chunk = extractAltChunk(payloadObj);
        if (chunk !== null) {
          const delta = appendAltStream(state, chunk);
          if (delta) {
            res.write(`data: ${JSON.stringify({ event: "message", answer: delta })}\n\n`);
          } else if (chunk && !state.toolBlock && !state.toolDump) {
            state.streamedText += chunk;
            res.write(
              `data: ${JSON.stringify({ event: "message", answer: chunk })}\n\n`,
            );
          }
        } else {
          captureAltFinalText(state, payloadObj);
        }
      }
    } catch {
      // ignore
    }
  }

  if (!state.errorSent && !state.streamedText && !state.finalText && state.lastPayload) {
    const fallback = extractAltAnswer(state.lastPayload);
    if (fallback) state.finalText = fallback;
  }

  if (!state.errorSent && !state.streamedText && state.finalText) {
    res.write(
      `data: ${JSON.stringify({ event: "message", answer: state.finalText })}\n\n`,
    );
  } else if (!state.errorSent && !state.streamedText && state.rawStreamedText) {
    const cleaned = filterAltText(
      { toolBlock: false, toolDump: false },
      state.rawStreamedText,
    );
    const fallback = cleaned.trim() ? cleaned : state.rawStreamedText;
    res.write(
      `data: ${JSON.stringify({ event: "message", answer: fallback })}\n\n`,
    );
  } else if (!state.errorSent && !state.streamedText) {
    state.finalText = EMPTY_ALT_ANSWER;
    res.write(
      `data: ${JSON.stringify({ event: "message", answer: state.finalText })}\n\n`,
    );
  }

  const finalAnswerForLog = state.streamedText || state.finalText || "";
  logMessageSummary(
    requestId,
    state.errorSent
      ? "error"
      : finalAnswerForLog === EMPTY_ALT_ANSWER
        ? "empty-fallback"
        : state.externalMessageId
          ? "done"
          : "done-no-message-id",
    {
      threadId: threadIdForLog,
      queryLength: payload.query.length,
      externalMessageId: state.externalMessageId || "",
      answerLength: finalAnswerForLog.length,
      answerPreview: finalAnswerForLog.slice(0, 160),
      metaSent: state.metaSent,
      errorSent: state.errorSent,
      lastPayload: summarizeAltPayloadForMessage(state.lastPayload),
    },
  );

  res.write(`data: ${JSON.stringify({ event: "message_end" })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

/**
 * 处理线程创建接口，向上游申请新的对话线程。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @returns {Promise<void>}
 */
async function handleAltThread(req, res) {
  const threadUrl = getAltThreadUrl();
  if (!threadUrl) {
    sendJson(res, 500, { error: "服务端缺少 ALT_THREAD_URL 配置", source: "server-config" });
    return;
  }

  let token = "";
  try {
    token = await getAltAuthToken();
  } catch (err) {
    sendJson(res, 500, { error: `上游认证失败：${String(err?.message || err)}`, source: "alt-auth" });
    return;
  }

  const body = await readBodyJson(req);
  const payload = {
    title: String(body?.title || "新对话"),
    agent_id: String(body?.agent_id || ALT_AGENT_ID),
    metadata: typeof body?.metadata === "object" && body?.metadata ? body.metadata : {},
  };

  const upstreamRes = await safeFetch(threadUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "ALT thread service");

  const text = await upstreamRes.text().catch(() => "");
  if (!upstreamRes.ok) {
    sendJson(res, upstreamRes.status, formatUpstreamError("线程上游", upstreamRes.status, text));
    return;
  }

  try {
    const data = JSON.parse(text || "{}");
    sendJson(res, 200, data);
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

/**
 * 处理 OAuth 授权码换 token 接口。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @returns {Promise<void>}
 */
async function handleAuthToken(req, res) {
  const tokenUrl = getAuthTokenUrlBase();
  if (!tokenUrl) {
    sendJson(res, 500, { error: "服务端缺少 AUTH_SERVER_DOMAIN 配置", source: "server-config" });
    return;
  }
  if (!AUTH_CLIENT_ID || !AUTH_CLIENT_SECRET) {
    sendJson(res, 500, { error: "服务端缺少 AUTH_CLIENT_ID 或 AUTH_CLIENT_SECRET 配置", source: "server-config" });
    return;
  }

  const body = await readBodyJson(req);
  const code = String(body?.code || "");
  const redirectUri = String(body?.redirectUri || AUTH_REDIRECT_URI || "");
  if (!code) {
    sendJson(res, 400, { error: "Missing code" });
    return;
  }
  if (!redirectUri) {
    sendJson(res, 400, { error: "Missing redirectUri" });
    return;
  }

  const params = new URLSearchParams();
  params.set("grant_type", "authorization_code");
  params.set("client_id", AUTH_CLIENT_ID);
  params.set("client_secret", AUTH_CLIENT_SECRET);
  params.set("code", code);
  params.set("redirect_uri", redirectUri);

  const upstreamRes = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const text = await upstreamRes.text().catch(() => "");
  if (!upstreamRes.ok) {
    sendJson(res, upstreamRes.status, formatUpstreamError("OAuth Token 接口", upstreamRes.status, text));
    return;
  }

  try {
    const data = JSON.parse(text || "{}");
    sendJson(res, 200, data);
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

/**
 * 处理 OAuth userinfo 代理接口。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @returns {Promise<void>}
 */
async function handleAuthUserInfo(req, res) {
  const userInfoUrl = getAuthUserInfoUrlBase();
  if (!userInfoUrl) {
    sendJson(res, 500, { error: "服务端缺少 AUTH_SERVER_DOMAIN 配置", source: "server-config" });
    return;
  }

  const authHeader = String(req.headers.authorization || "");
  if (!authHeader) {
    sendJson(res, 400, { error: "Missing Authorization header" });
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[AUTH USERINFO] GET ${userInfoUrl}`);
  const upstreamRes = await fetch(userInfoUrl, {
    method: "GET",
    headers: {
      accept: "application/json",
      Authorization: authHeader,
    },
  });

  const text = await upstreamRes.text().catch(() => "");
  if (!upstreamRes.ok) {
    // eslint-disable-next-line no-console
    console.log(`[AUTH USERINFO] status=${upstreamRes.status}`);
    let errorCode = null;
    let parsed = null;
    try {
      parsed = JSON.parse(text || "{}");
      errorCode = parsed?.errorCode ?? null;
    } catch {
      parsed = null;
    }
    appendAuthUserInfoLog({
      event: "auth:userinfo:error",
      url: userInfoUrl,
      status: upstreamRes.status,
      errorCode,
      data: parsed,
      raw: parsed ? undefined : text,
    });
    sendJson(res, upstreamRes.status, {
      ...formatUpstreamError("OAuth UserInfo 接口", upstreamRes.status, text),
      errorCode,
      data: parsed,
      url: userInfoUrl,
      status: upstreamRes.status,
    });
    return;
  }

  try {
    const data = JSON.parse(text || "{}");
    appendAuthUserInfoLog({
      event: "auth:userinfo:success",
      url: userInfoUrl,
      status: upstreamRes.status,
      data,
    });
    sendJson(res, 200, data);
  } catch {
    appendAuthUserInfoLog({
      event: "auth:userinfo:raw",
      url: userInfoUrl,
      status: upstreamRes.status,
      raw: text,
    });
    sendJson(res, 200, { raw: text });
  }
}

async function handleAuthUserInfoClientLog(req, res) {
  const body = await readBodyJson(req);
  appendAuthUserInfoLog({
    event: "auth:userinfo:client",
    source: String(body.source || "client"),
    data: body.userInfo || body.data || {},
  });
  sendJson(res, 200, { ok: true });
}

async function handleClientLog(req, res) {
  const body = await readBodyJson(req);
  appendClientLog({
    event: String(body.event || "client:log"),
    source: String(body.source || "h5"),
    data: body.data && typeof body.data === "object" ? body.data : {},
  });
  sendJson(res, 200, { ok: true });
}

/**
 * 处理消息反馈提交接口。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @returns {Promise<void>}
 */
async function handleFeedback(req, res) {
  const body = await readBodyJson(req);
  const originalMessageId = String(body?.messageId || "").trim();
  const rating = String(body?.rating || "").trim();
  const reason = String(body?.reason || "");

  if (!originalMessageId) {
    sendJson(res, 400, { error: "Missing messageId" });
    return;
  }
  if (rating !== "like" && rating !== "dislike") {
    sendJson(res, 400, { error: "Invalid rating" });
    return;
  }

  const payload = {
    rating,
    reason: rating === "dislike" ? (reason || null) : null,
  };

  let token = "";
  try {
    token = await getAltAuthToken();
  } catch (err) {
    sendFeedbackAcceptedFallback(res, {
      reason: "auth-error",
      originalMessageId,
      rating,
      payload,
      error: String(err?.message || err || ""),
    });
    return;
  }

  const cookieHeader = String(req.headers.cookie || "");
  let messageId = "";
  try {
    messageId = await resolveFeedbackMessageId(originalMessageId, token, cookieHeader);
  } catch (err) {
    sendFeedbackAcceptedFallback(res, {
      reason: "message-id-resolve-error",
      originalMessageId,
      rating,
      payload,
      error: String(err?.message || err || ""),
    });
    return;
  }
  if (!isIntegerMessageId(messageId)) {
    sendFeedbackAcceptedFallback(res, {
      reason: "message-id-unresolved",
      messageId,
      originalMessageId,
      rating,
      payload,
    });
    return;
  }

  const feedbackUrl = getFeedbackUrl(messageId);
  if (!feedbackUrl) {
    sendJson(res, 500, { error: "服务端缺少 FEEDBACK_BASE_URL 配置", source: "server-config" });
    return;
  }
  let upstreamRes;
  try {
    upstreamRes = await safeFetch(
      feedbackUrl,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: JSON.stringify(payload),
      },
      "ALT feedback service",
    );
  } catch (err) {
    sendFeedbackAcceptedFallback(res, {
      reason: "upstream-unreachable",
      feedbackUrl,
      messageId,
      originalMessageId,
      rating,
      payload,
      error: String(err?.message || err || ""),
    });
    return;
  }

  const text = await upstreamRes.text().catch(() => "");
  if (upstreamRes.status === 409) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:duplicate",
      feedbackUrl,
      messageId,
      originalMessageId,
      rating,
      responseText: text,
    });
    sendJson(res, 200, { ok: true, persisted: true, duplicate: true });
    return;
  }
  if (!upstreamRes.ok) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:error",
      feedbackUrl,
      status: upstreamRes.status,
      messageId,
      originalMessageId,
      rating,
      payload,
      responseText: text,
    });
    if (upstreamRes.status >= 500) {
      sendFeedbackAcceptedFallback(res, {
        reason: "upstream-error",
        feedbackUrl,
        status: upstreamRes.status,
        messageId,
        originalMessageId,
        rating,
        payload,
        responseText: text,
      });
      return;
    }
    sendJson(res, upstreamRes.status, formatUpstreamError("反馈上游", upstreamRes.status, text));
    return;
  }

  try {
    const data = JSON.parse(text || "{}");
    sendJson(res, 200, data);
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

/**
 * 处理消息反馈状态查询接口。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @param {string} messageId 外部消息 ID。
 * @returns {Promise<void>}
 */
async function handleFeedbackStatus(req, res, messageId) {
  const originalMessageId = String(messageId || "").trim();
  if (!originalMessageId) {
    sendJson(res, 400, { error: "Missing messageId" });
    return;
  }

  let token = "";
  try {
    token = await getAltAuthToken();
  } catch (err) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:status:auth-error",
      originalMessageId,
      error: String(err?.message || err || ""),
    });
    sendJson(res, 200, { has_feedback: false, feedback: null, upstreamUnavailable: true });
    return;
  }

  const cookieHeader = String(req.headers.cookie || "");
  let trimmedId = "";
  try {
    trimmedId = await resolveFeedbackMessageId(originalMessageId, token, cookieHeader);
  } catch (err) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:status:resolve-error",
      originalMessageId,
      error: String(err?.message || err || ""),
    });
    sendJson(res, 200, { has_feedback: false, feedback: null, upstreamUnavailable: true });
    return;
  }
  if (!isIntegerMessageId(trimmedId)) {
    sendJson(res, 200, { has_feedback: false, feedback: null, unresolvedMessageId: true });
    return;
  }

  const feedbackUrl = getFeedbackUrl(trimmedId);
  if (!feedbackUrl) {
    sendJson(res, 500, { error: "服务端缺少 FEEDBACK_BASE_URL 配置", source: "server-config" });
    return;
  }
  let upstreamRes;
  try {
    upstreamRes = await safeFetch(
      feedbackUrl,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      },
      "ALT feedback status service",
    );
  } catch (err) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:status:upstream-unreachable",
      feedbackUrl,
      originalMessageId,
      trimmedId,
      error: String(err?.message || err || ""),
    });
    sendJson(res, 200, { has_feedback: false, feedback: null, upstreamUnavailable: true });
    return;
  }

  const text = await upstreamRes.text().catch(() => "");
  if (!upstreamRes.ok) {
    appendJsonLog(SERVER_LOG_PREFIX, {
      ts: new Date().toISOString(),
      event: "feedback:status:error",
      feedbackUrl,
      originalMessageId,
      trimmedId,
      status: upstreamRes.status,
      responseText: text,
    });
    if (upstreamRes.status >= 500) {
      sendJson(res, 200, { has_feedback: false, feedback: null, upstreamUnavailable: true });
      return;
    }
    sendJson(res, upstreamRes.status, formatUpstreamError("反馈状态上游", upstreamRes.status, text));
    return;
  }

  try {
    const data = JSON.parse(text || "{}");
    sendJson(res, 200, data);
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

/**
 * 处理静态资源访问，默认回退到 H5 前端文件。
 *
 * @param {http.IncomingMessage} req 请求对象。
 * @param {http.ServerResponse} res 响应对象。
 * @returns {Promise<void>}
 */
async function handleStatic(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname = stripStaticBasePath(decodeURIComponent(url.pathname || "/"));
  if (pathname === "/") pathname = "/index.html";

  const requested = path.normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const st = await fs.stat(filePath);
    if (!st.isFile()) throw new Error("Not a file");

    const buf = await fs.readFile(filePath);
    res.writeHead(200, {
      ...corsHeaders(),
      "Content-Type": guessContentType(filePath),
      "Cache-Control": "no-store",
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

/**
 * HTTP 服务器入口，根据路径分发到各个业务处理函数。
 */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        difyBaseUrl: DIFY_BASE_URL,
        keyConfigured: Boolean(DIFY_API_KEY),
        altConfigured: Boolean(ALT_API_TOKEN || ALT_AUTH_URL),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth-config") {
      sendJson(res, 200, {
        authorizeUrlBase: getAuthAuthorizeUrlBase(),
        clientId: AUTH_CLIENT_ID,
        redirectUri: AUTH_REDIRECT_URI,
        scope: AUTH_SCOPE,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth-token") {
      await handleAuthToken(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth-userinfo") {        
      await handleAuthUserInfo(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth-userinfo-log") {
      await handleAuthUserInfoClientLog(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/client-log") {
      await handleClientLog(req, res);
      return;
    }

    if (url.pathname === "/api/feedback") {
      if (req.method === "POST") {
        await handleFeedback(req, res);
        return;
      }
      if (req.method === "GET") {
        await handleFeedbackStatus(req, res, url.searchParams.get("messageId"));
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/conversations") {
      await handleConversationsList(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/message-meta") {
      await handleMessageMeta(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/conversations/sync") {
      await handleConversationsSync(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/alt-chat") {
      await handleAltChat(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/alt-chat-stream") {
      await handleAltChatStream(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/alt-thread") {
      await handleAltThread(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/chat-messages") {
      await handleChatMessages(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await handleStatic(req, res);
      return;
    }

    res.writeHead(405, { ...corsHeaders(), "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
  } catch (err) {
    const code = err?.statusCode || 500;
    sendJson(res, code, {
      error: formatInternalError(err),
      source: "server",
      errorCode: String(err?.code || ""),
    });
  }
});

/**
 * 启动前先补齐数据库结构，再启动 HTTP 服务。
 */
ensureSchema()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      const activeUpstreams = {
        ALT_API_URL,
        ALT_AUTH_URL,
        ALT_THREAD_URL: getAltThreadUrl(),
      };
      // eslint-disable-next-line no-console
      console.log(`H5 Chatbot proxy listening on http://localhost:${PORT}`);
      // eslint-disable-next-line no-console
      console.log(`Serving static from ${PUBLIC_DIR}`);
      // eslint-disable-next-line no-console
      console.log("[Config] Active upstreams:", activeUpstreams);
      appendJsonLog(SERVER_LOG_PREFIX, {
        ts: new Date().toISOString(),
        event: "server:start",
        port: PORT,
        publicDir: PUBLIC_DIR,
        activeUpstreams,
      });
    });
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to ensure database schema:", err);
    process.exit(1);
  });

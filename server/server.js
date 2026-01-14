const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const mysql = require("mysql2/promise");
const { Readable } = require("node:stream");

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const DIFY_BASE_URL = String(process.env.DIFY_BASE_URL || "https://api.dify.ai/v1").replace(/\/+$/, "");
const DIFY_API_KEY = String(process.env.DIFY_API_KEY || "");
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "*");
const ALT_API_URL = String(
  process.env.ALT_API_URL || "http://150.223.194.216:5050/api/chat/agent/ChatbotAgent",
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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function getAuthAuthorizeUrlBase() {
  return buildAuthUrl(AUTH_AUTHORIZE_PATH);
}

function getAuthTokenUrlBase() {
  return buildAuthUrl(AUTH_TOKEN_PATH);
}

function getAuthUserInfoUrlBase() {
  return buildAuthUrl(AUTH_USERINFO_PATH);
}

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

function sendJson(res, status, obj) {
  res.writeHead(status, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function guessContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

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


function normalizeMessage(msg) {
  const role = msg?.role === "assistant" ? "assistant" : "user";
  const content = String(msg?.content || "");
  const time = String(msg?.time || "");
  return { role, content, time };
}

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

function normalizeUserPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items.map(normalizeConversation) : [];
  const preferredActive = String(payload?.activeId || "");
  const activeId = items.some((c) => c.id === preferredActive) ? preferredActive : items[0]?.id || "";
  return { items, activeId };
}

const altTokenCache = { token: "", expMs: 0 };
let altTokenPromise = null;

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

function hasValidAltToken() {
  return altTokenCache.token && Date.now() < altTokenCache.expMs;
}

async function requestAltToken() {
  if (!ALT_AUTH_URL || !ALT_AUTH_USERNAME || !ALT_AUTH_PASSWORD) {
    throw new Error("Missing ALT auth config");
  }
  const params = new URLSearchParams();
  params.set("grant_type", "password");
  params.set("username", ALT_AUTH_USERNAME);
  params.set("password", ALT_AUTH_PASSWORD);
  params.set("scope", ALT_AUTH_SCOPE);
  params.set("client_id", ALT_AUTH_CLIENT_ID);
  params.set("client_secret", ALT_AUTH_CLIENT_SECRET);

  const res = await fetch(ALT_AUTH_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

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
      `SELECT conversation_id, role, content, time_label, position FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY conversation_id, position`,
      convIds,
    );

    const msgMap = new Map();
    for (const row of msgRows) {
      const list = msgMap.get(row.conversation_id) || [];
      list.push({
        role: row.role === "assistant" ? "assistant" : "user",
        content: String(row.content || ""),
        time: String(row.time_label || ""),
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

async function syncUserConversations(userKey, payload) {
  const normalized = normalizeUserPayload(payload);
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
        ]);
        await conn.query(
          "INSERT INTO messages (conversation_id, role, content, time_label, position, created_at_ms) VALUES ?",
          [values],
        );
      }
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
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

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

async function handleConversationsList(req, res, url) {
  const userId = String(url.searchParams.get("userId") || "");
  if (!userId) {
    sendJson(res, 400, { error: "Missing userId" });
    return;
  }

  const data = await fetchUserConversations(userId);
  sendJson(res, 200, { items: data.items || [], activeId: data.activeId || "" });
}

async function handleConversationsSync(req, res) {
  const body = await readBodyJson(req);
  const userId = String(body?.userId || "");
  if (!userId) {
    sendJson(res, 400, { error: "Missing userId" });
    return;
  }

  await syncUserConversations(userId, body);
  sendJson(res, 200, { ok: true });
}

function extractAltAnswer(data) {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
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
      if (cleaned.trim()) return cleaned;
    }
  }
  try {
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

function stripAltText(text) {
  let out = String(text || "");
  if (!out) return "";
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "");
  out = out.replace(/^\s*(思考|Thought|Reasoning)\s*[:：].*\n?/i, "");
  return out;
}

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

function filterAltText(state, text) {
  let out = stripAltText(text);
  out = stripToolBlocks(state, out);
  out = out.replace(/<\/?tool_call[^>]*>/gi, "");
  out = out.replace(/<\/?tool[^>]*>/gi, "");
  out = out.replace(/^\s*tool_call.*$/gim, "");
  out = stripToolDump(state, out);
  return out;
}

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

function consumeAltPayload(state, payload) {
  if (!payload || typeof payload !== "object") return;
  state.hasParsed = true;
  if (hasToolPayload(payload)) {
    return;
  }
  if (payload.response === null) {
    return;
  }
  state.lastPayload = payload;

  const response = typeof payload.response === "string" ? payload.response : "";
  const msgContent = typeof payload.msg?.content === "string" ? payload.msg.content : "";
  const msgType = String(payload.msg?.type || "");
  const status = String(payload.status || "");
  const role = String(payload.msg?.role || "");
  const msgTypeLower = msgType.toLowerCase();

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

async function readAltResponse(upstreamRes) {
  const reader = upstreamRes.body?.getReader();
  if (!reader) {
    return { answer: "", raw: null };
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
      return { answer, raw: obj };
    } catch {
      // ignore
    }
  }

  return { answer, raw: state.lastPayload };
}

async function handleAltChat(req, res) {
  if (!ALT_API_URL) {
    sendJson(res, 500, { error: "Missing ALT_API_URL env var on server" });
    return;
  }
  let token = "";
  try {
    token = await getAltAuthToken();
  } catch (err) {
    sendJson(res, 500, { error: String(err?.message || err) });
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

  const upstreamRes = await fetch(ALT_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  if (!upstreamRes.ok) {
    const txt = await upstreamRes.text().catch(() => "");
    sendJson(res, upstreamRes.status, { error: txt || upstreamRes.statusText || "Request failed" });
    return;
  }

  const result = await readAltResponse(upstreamRes);
  sendJson(res, 200, { answer: result.answer || "", raw: result.raw || null });
}

function extractAltChunk(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.response === null) return null;
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
  const raw = msgContent !== "" ? msgContent : response !== "" ? response : "";
  if (raw !== "") return raw;
  return null;
}

async function handleAltChatStream(req, res) {
  if (!ALT_API_URL) {
    sendJson(res, 500, { error: "Missing ALT_API_URL env var on server" });
    return;
  }
  let token = "";
  try {
    token = await getAltAuthToken();
  } catch (err) {
    sendJson(res, 500, { error: String(err?.message || err) });
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

  const upstreamRes = await fetch(ALT_API_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  if (!upstreamRes.ok) {
    const txt = await upstreamRes.text().catch(() => "");
    sendJson(res, upstreamRes.status, { error: txt || upstreamRes.statusText || "Request failed" });
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
    streamedText: "",
    rawStreamedText: "",
    lastChunk: "",
    toolBlock: false,
    toolDump: false,
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
        const chunk = extractAltChunk(payloadObj);
        if (chunk !== null) {
          const delta = appendAltStream(state, chunk);
          if (delta) {
            res.write(`data: ${JSON.stringify({ event: "message", answer: delta })}\n\n`);
          }
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
      const chunk = extractAltChunk(payloadObj);
      if (chunk !== null) {
        const delta = appendAltStream(state, chunk);
        if (delta) {
          res.write(`data: ${JSON.stringify({ event: "message", answer: delta })}\n\n`);
        }
      }
    } catch {
      // ignore
    }
  }

  res.write(`data: ${JSON.stringify({ event: "message_end" })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

async function handleAltThread(req, res) {
  const threadUrl = getAltThreadUrl();
  if (!threadUrl) {
    sendJson(res, 500, { error: "Missing ALT_THREAD_URL env var on server" });
    return;
  }

  let token = "";
  try {
    token = await getAltAuthToken();
  } catch (err) {
    sendJson(res, 500, { error: String(err?.message || err) });
    return;
  }

  const body = await readBodyJson(req);
  const payload = {
    title: String(body?.title || "新对话"),
    agent_id: String(body?.agent_id || ALT_AGENT_ID),
    metadata: typeof body?.metadata === "object" && body?.metadata ? body.metadata : {},
  };

  const upstreamRes = await fetch(threadUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await upstreamRes.text().catch(() => "");
  if (!upstreamRes.ok) {
    sendJson(res, upstreamRes.status, { error: text || upstreamRes.statusText || "Request failed" });
    return;
  }

  try {
    const data = JSON.parse(text || "{}");
    sendJson(res, 200, data);
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

async function handleAuthToken(req, res) {
  const tokenUrl = getAuthTokenUrlBase();
  if (!tokenUrl) {
    sendJson(res, 500, { error: "Missing AUTH_SERVER_DOMAIN env var on server" });
    return;
  }
  if (!AUTH_CLIENT_ID || !AUTH_CLIENT_SECRET) {
    sendJson(res, 500, { error: "Missing AUTH_CLIENT_ID/AUTH_CLIENT_SECRET env var on server" });
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
    sendJson(res, upstreamRes.status, { error: text || upstreamRes.statusText || "Request failed" });
    return;
  }

  try {
    const data = JSON.parse(text || "{}");
    sendJson(res, 200, data);
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

async function handleAuthUserInfo(req, res) {
  const userInfoUrl = getAuthUserInfoUrlBase();
  if (!userInfoUrl) {
    sendJson(res, 500, { error: "Missing AUTH_SERVER_DOMAIN env var on server" });
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
    sendJson(res, upstreamRes.status, {
      error: text || upstreamRes.statusText || "Request failed",
      errorCode,
      data: parsed,
      url: userInfoUrl,
      status: upstreamRes.status,
    });
    return;
  }

  try {
    const data = JSON.parse(text || "{}");
    sendJson(res, 200, data);
  } catch {
    sendJson(res, 200, { raw: text });
  }
}

async function handleStatic(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname || "/");
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

    if (req.method === "GET" && url.pathname === "/api/conversations") {
      await handleConversationsList(req, res, url);
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
    sendJson(res, code, { error: String(err?.message || err) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`H5 Chatbot proxy listening on http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`Serving static from ${PUBLIC_DIR}`);
});

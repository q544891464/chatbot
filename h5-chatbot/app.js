import { getLoginUserInfo } from "./platform-bridge.js";
const STORAGE_KEY = "h5ChatbotConfig:v1";
const LEGACY_CHAT_KEY = "h5ChatbotChat:v1";
const AUTH_STORAGE_KEY = "h5ChatbotAuth:v1";
const AGENT_ID = "ChatbotAgent";
const FEEDBACK_ENDPOINT_PATH = "/feedback";
const DEFAULT_USER_META = {
  userName: "test",
  org: "org1",
  phone: "1234567890",
};
const el = {
  connHint: document.getElementById("connHint"),
  messages: document.getElementById("messages"),
  input: document.getElementById("input"),
  sendBtn: document.getElementById("sendBtn"),
  stopBtn: document.getElementById("stopBtn"),
  tips: document.getElementById("tips"),
  settingsBtn: document.getElementById("settingsBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  scrollBtn: document.getElementById("scrollBtn"),
  chatListBtn: document.getElementById("chatListBtn"),
  modal: document.getElementById("settingsModal"),
  backdrop: document.getElementById("settingsBackdrop"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  settingsForm: document.getElementById("settingsForm"),
  baseUrl: document.getElementById("baseUrl"),
  apiKey: document.getElementById("apiKey"),
  userId: document.getElementById("userId"),
  responseMode: document.getElementById("responseMode"),
  resetConversationBtn: document.getElementById("resetConversationBtn"),
  clearChatBtn: document.getElementById("clearChatBtn"),
  chatListModal: document.getElementById("chatListModal"),
  chatListBackdrop: document.getElementById("chatListBackdrop"),
  closeChatListBtn: document.getElementById("closeChatListBtn"),
  chatList: document.getElementById("chatList"),
  newChatFromListBtn: document.getElementById("newChatFromListBtn"),
  platform: document.getElementById("platform"),
  apiKeyField: document.getElementById("apiKeyField"),
  responseModeField: document.getElementById("responseModeField"),
  userInfoName: document.getElementById("userInfoName"),
  userInfoPhone: document.getElementById("userInfoPhone"),
  userInfoOrg: document.getElementById("userInfoOrg"),
  authStartBtn: document.getElementById("authStartBtn"),
  authCodeValue: document.getElementById("authCodeValue"),
  authStateValue: document.getElementById("authStateValue"),
  authAccessTokenValue: document.getElementById("authAccessTokenValue"),
  authRefreshTokenValue: document.getElementById("authRefreshTokenValue"),
  imageViewer: document.getElementById("imageViewer"),
  imageViewerBackdrop: document.getElementById("imageViewerBackdrop"),
  imageViewerContent: document.getElementById("imageViewerContent"),
  imageViewerImg: document.getElementById("imageViewerImg"),
};
function nowTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function clampMessages(list) {
  const MAX = 80;
  return list.length > MAX ? list.slice(list.length - MAX) : list;
}
function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function loadAuthState() {
  return safeJsonParse(localStorage.getItem(AUTH_STORAGE_KEY) || "null", {
    code: "",
    state: "",
    accessToken: "",
    refreshToken: "",
    tokenType: "",
    expiresIn: 0,
    receivedAt: 0,
  });
}
function saveAuthState(payload) {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      code: String(payload?.code || ""),
      state: String(payload?.state || ""),
      accessToken: String(payload?.accessToken || ""),
      refreshToken: String(payload?.refreshToken || ""),
      tokenType: String(payload?.tokenType || ""),
      expiresIn: Number(payload?.expiresIn || 0),
      receivedAt: Number(payload?.receivedAt || 0),
    }),
  );
}
function normalizeBaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}
function isProxyBaseUrl(baseUrl) {
  const b = normalizeBaseUrl(baseUrl);
  return b === "/api" || b.endsWith("/api");
}
function randomId(prefix = "u") {
  const rnd = Math.random().toString(16).slice(2);
  return `${prefix}-${Date.now().toString(16)}-${rnd}`;
}
function loadConfig() {
  const saved = safeJsonParse(
    localStorage.getItem(STORAGE_KEY) || "null",
    null,
  );
  const baseUrl = normalizeBaseUrl(saved?.baseUrl || "/api");
  const apiKey = String(saved?.apiKey || "");
  const userId = String(saved?.userId || randomId("user"));
  const responseMode = "streaming";
  const platform = "agent";
  return { baseUrl, apiKey, userId, responseMode, platform };
}
function saveConfig(cfg) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      baseUrl: normalizeBaseUrl(cfg.baseUrl),
      apiKey: String(cfg.apiKey || ""),
      userId: String(cfg.userId || ""),
      responseMode: "streaming",
      platform: "agent",
    }),
  );
} // Choose a stable identifier for server-side conversation storage.

function pickPlatformUserId(userInfo) {
  if (!userInfo || typeof userInfo !== "object") return "";
  const candidates = [
    userInfo.phone,
    userInfo.mobile,
    userInfo.userId,
    userInfo.useId,
    userInfo.uid,
    userInfo.id,
  ];
  for (const item of candidates) {
    const value = String(item || "").trim();
    if (value) return value;
  }
  return "";
}
function deriveTitleFromMessages(messages) {
  const first = (messages || []).find((m) => m?.role === "user" && m?.content);
  const text = String(first?.content || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "新对话";
  return text.length > 18 ? `${text.slice(0, 18)}…` : text;
}
function normalizeConversation(item) {
  const now = Date.now();
  const messages = Array.isArray(item?.messages) ? item.messages : [];
  const platform = "agent";
  const title =
    String(item?.title || "").trim() || deriveTitleFromMessages(messages);
  return {
    id: String(item?.id || randomId("conv")),
    title,
    conversationId: String(item?.conversationId || ""),
    platform,
    messages: clampMessages(messages),
    createdAt: Number(item?.createdAt || now),
    updatedAt: Number(item?.updatedAt || now),
  };
}
function createConversation(seed) {
  const now = Date.now();
  const base = normalizeConversation({
    id: randomId("conv"),
    title: seed?.title || "新对话",
    conversationId: seed?.conversationId || "",
    platform: seed?.platform || "agent",
    messages: seed?.messages || [],
    createdAt: now,
    updatedAt: now,
  });
  return base;
}
function getStoreBase() {
  const b = normalizeBaseUrl(state.config.baseUrl);
  return isProxyBaseUrl(b) ? b : "/api";
}
async function fetchConversationsFromServer() {
  const url = `${getStoreBase()}/conversations?userId=${encodeURIComponent(state.config.userId)}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "load conversations failed");
  }
  const data = await res.json();
  const items = Array.isArray(data?.items)
    ? data.items.map(normalizeConversation)
    : [];
  const preferredId = String(data?.activeId || "");
  const activeId = items.some((c) => c.id === preferredId)
    ? preferredId
    : items[0]?.id || "";
  return { items, activeId };
}
function serializeConversation(conv) {
  return {
    id: String(conv.id || randomId("conv")),
    title: String(conv.title || "新对话"),
    conversationId: String(conv.conversationId || ""),
    platform: "agent",
    messages: clampMessages(conv.messages || []),
    createdAt: Number(conv.createdAt || Date.now()),
    updatedAt: Number(conv.updatedAt || Date.now()),
  };
}
function applyMessageIds(messageIdMap) {
  if (!messageIdMap || typeof messageIdMap !== "object") return;
  for (const conv of state.conversations) {
    const ids = messageIdMap[conv.id];
    if (!Array.isArray(ids) || !ids.length) continue;
    conv.messages.forEach((msg, idx) => {
      const id = ids[idx];
      if (id !== undefined && id !== null && String(id).trim()) {
        msg.id = id;
      }
    });
  }
}
async function syncConversationsToServer(payload) {
  const url = `${getStoreBase()}/conversations/sync`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: state.config.userId,
      activeId: payload.activeId,
      items: payload.items,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "sync conversations failed");
  }
  const data = await res.json().catch(() => ({}));
  if (data?.messageIds) {
    applyMessageIds(data.messageIds);
  }
  return data;
}
function saveConversations() {
  sortConversations();
  const payload = {
    activeId: state.activeId,
    items: state.conversations.map(serializeConversation),
  };
  syncConversationsToServer(payload).catch(() => {
    setTips("会话同步失败，请检查服务是否启动。");
  });
}
const initialConfig = loadConfig();
const initialConversation = createConversation({ platform: "agent" });
const DEFAULT_QUESTION_BANK = [
  "干部问责管理",
  "我想竞选干部，对于青年员工来说要怎么做",
  "导师课程开发费用",
  "我今年11岗级，我想晋升到15岗级，我需要满足什么条件呢？",
  "五险一金的缴纳比例",
];
const state = {
  config: initialConfig,
  conversations: [initialConversation],
  activeId: initialConversation.id,
  inFlight: null,
  platformUser: null,
  auth: loadAuthState(),
  questionBank: DEFAULT_QUESTION_BANK.slice(),
  promptSelection: { pending: false, value: "" },
};
const IS_MOBILE = (() => {
  const ua = navigator.userAgent || "";
  const touch = navigator.maxTouchPoints || 0;
  return /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(ua) || touch > 1;
})(); // Try to sync userId from the platform SDK before loading conversations.

async function initPlatformUser() {
  try {
    const userInfo = await getLoginUserInfo();
    state.platformUser = userInfo || null;
    const userId = pickPlatformUserId(userInfo);
    if (!userId) return false;
    if (userId !== state.config.userId) {
      state.config.userId = userId;
      saveConfig(state.config);
    }
    updateUserInfoDisplay();
    return true;
  } catch {
    return false;
  }
}
async function initConversations() {
  try {
    const data = await fetchConversationsFromServer();
    if (data.items.length) {
      state.conversations = data.items;
      state.activeId = data.activeId || data.items[0].id;
      sortConversations();
      renderAll();
      updateConversationList();
      updateScrollButton();
    }
  } catch {
    setTips("未能连接会话存储服务，将在本地临时使用。");
  }
  const legacy = safeJsonParse(
    localStorage.getItem(LEGACY_CHAT_KEY) || "null",
    null,
  );
  if (legacy) {
    localStorage.removeItem(LEGACY_CHAT_KEY);
  }
}
async function loadQuestionBank() {
  try {
    const res = await fetch("./question-bank.json", { cache: "no-store" });
    if (!res.ok) throw new Error("load failed");
    const data = await res.json();
    const items = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : [];
    state.questionBank = items
      .map((item) => String(item).trim())
      .filter(Boolean);
    if (!state.questionBank.length) {
      state.questionBank = DEFAULT_QUESTION_BANK.slice();
    }
  } catch {
    state.questionBank = DEFAULT_QUESTION_BANK.slice();
  }
}
function isConfigured(cfg) {
  if (!cfg.userId) return false;
  return true;
}
function setTips(text) {
  el.tips.textContent = text || "";
}
function getFeedbackUrl() {
  return `${getStoreBase()}
${FEEDBACK_ENDPOINT_PATH}`;
}
async function ensureFeedbackId(message) {
  if (message?.externalMessageId) return message.externalMessageId;
  const payload = {
    activeId: state.activeId,
    items: state.conversations.map(serializeConversation),
  };
  try {
    await syncConversationsToServer(payload);
  } catch {
    // ignore
  }
  return message?.externalMessageId || "";
}
async function sendFeedback(message, rating, reason) {
  const id = await ensureFeedbackId(message);
  if (!id) {
    throw new Error("未获取到外部消息ID");
  }
  const payload = { messageId: id, rating };
  if (rating === "dislike") {
    payload.reason = reason || "";
  }
  const url = getFeedbackUrl();
  if (!url) {
    throw new Error("未获取到外部消息ID");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "反馈失败");
  }
}
function updateFeedbackState(meta, feedback, status) {
  const likeBtn = meta.querySelector('[data-feedback="like"]');
  const dislikeBtn = meta.querySelector('[data-feedback="dislike"]');
  const disabled = status === "typing" || Boolean(feedback);
  if (likeBtn) {
    likeBtn.disabled = disabled;
    likeBtn.classList.toggle("is-active", feedback === "like");
  }
  if (dislikeBtn) {
    dislikeBtn.disabled = disabled;
    dislikeBtn.classList.toggle("is-active", feedback === "dislike");
  }
}
function getPlatformLabel(platform) {
  return "ChatbotAgent";
}
function getActivePlatform() {
  const conv = getActiveConversation();
  return conv.platform || "agent";
}
function setConnHint() {
  if (!isConfigured(state.config)) {
    el.connHint.textContent = "未配置平台";
    return;
  }
  el.connHint.textContent = "已连接：ChatbotAgent";
}
function shouldAutoScroll(container) {
  const threshold = 120;
  return (
    container.scrollHeight - (container.scrollTop + container.clientHeight) <
    threshold
  );
}
function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}
function getActiveConversation() {
  let conv = state.conversations.find((item) => item.id === state.activeId);
  if (!conv) {
    conv = createConversation({ platform: "agent" });
    state.conversations.unshift(conv);
    state.activeId = conv.id;
    saveConversations();
  }
  return conv;
}
function sortConversations() {
  state.conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
function formatConversationTime(ts) {
  const d = new Date(ts || Date.now());
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}
function updateConversationList() {
  if (!el.chatList) return;
  sortConversations();
  el.chatList.innerHTML = "";
  for (const conv of state.conversations) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `chatlist__item${conv.id === state.activeId ? " is-active" : ""}`;
    item.dataset.id = conv.id;
    const title = document.createElement("div");
    title.className = "chatlist__title";
    title.textContent = conv.title || "新对话";
    const meta = document.createElement("div");
    meta.className = "chatlist__meta";
    const platform = conv.platform || state.config.platform;
    meta.textContent = `${formatConversationTime(conv.updatedAt)} · ${conv.messages.length} 条 · ${getPlatformLabel(platform)}`;
    item.appendChild(title);
    item.appendChild(meta);
    item.addEventListener("click", () => {
      selectConversation(conv.id);
      closeChatList();
    });
    el.chatList.appendChild(item);
  }
}
function openChatList() {
  closeSettings();
  updateConversationList();
  el.chatListModal.setAttribute("aria-hidden", "false");
}
function closeChatList() {
  el.chatListModal.setAttribute("aria-hidden", "true");
}
function selectConversation(id) {
  if (id === state.activeId) return;
  state.activeId = id;
  const conv = getActiveConversation();
  if (conv.platform) {
    state.config.platform = conv.platform;
    saveConfig(state.config);
  }
  saveConversations();
  renderAll();
  setConnHint();
  updateConversationList();
}
function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url || "");
}
function renderInlineMarkdown(escapedText) {
  let out = String(escapedText || "");
  const placeholders = [];
  const token = (i) => `@@MD${i}@@`;
  out = out.replace(/(^|\n)\s*([^\n*]{1,12})\*\*(?=\s*[:：])/g, "$1**$2**");
  const pushPlaceholder = (html) => {
    const i = placeholders.length;
    placeholders.push(html);
    return token(i);
  };
  const normalizeUrlToken = (raw) => {
    let url = String(raw || "");
    if (!url) return url;
    url = url.replace(/^(&quot;|&#39;|&apos;|["'`<])+/gi, "");
    url = url.replace(/([>"'`]|&quot;|&#39;|&apos;)+$/gi, "");
    return url;
  };
  const renderUrlToken = (raw, altText) => {
    const url = normalizeUrlToken(raw);
    if (!url) return raw;
    if (isImageUrl(url)) {
      return pushPlaceholder(
        `<img src="${url}" alt="${altText || "image"}" loading="lazy" decoding="async" />`,
      );
    }
    return pushPlaceholder(
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
    );
  };
  out = out.replace(
    /!\[([^\]]*)\]\s*\(\s*(https?:\/\/[^\s)]+)\s*\)/g,
    (_, alt, url) => {
      return renderUrlToken(url, alt);
    },
  );
  out = out.replace(/`([^`\n]+)`/g, (_, code) => {
    return pushPlaceholder(`<code class="md-inline">${code}</code>`);
  });
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => {
      const cleanUrl = normalizeUrlToken(url);
      if (!cleanUrl) return label;
      return pushPlaceholder(
        `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`,
      );
    },
  );
  out = out.replace(/(https?:\/\/[^\s<]+[^\s<\.)])/g, (url) => {
    return renderUrlToken(url);
  });
  out = out.replace(/~~([^\n~]+)~~/g, "<del>$1</del>");
  out = out.replace(/(\*\*|__)([^\n]+?)\1/g, "<strong>$2</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  for (let i = 0; i < placeholders.length; i++) {
    out = out.replaceAll(token(i), placeholders[i]);
  }
  return out;
}
function normalizeMarkdownText(text) {
  let out = String(text || "");
  const urls = [];
  out = out.replace(/https?:\/\/[^\s<]+/g, (match) => {
    const idx = urls.length;
    urls.push(match);
    return `@@URL${idx}@@`;
  });
  out = out.replace(/([^\n])\s*(#{1,6})\s*(?=\S)/g, "$1\n$2 ");
  out = out.replace(/([:：。！？?.])\\s*([-*])\\s+(?=\\S)/g, "$1\\n$2 ");
  out = out.replace(/([:：。！？?.])\\s*(\\d+\\.)\\s+(?=\\S)/g, "$1\\n$2 ");
  out = out.replace(
    /([\u4e00-\u9fff。！？；：，、）\)\]】])\s*-\s*(?=\S)/g,
    "$1\n- ",
  );
  out = out.replace(
    /([\u4e00-\u9fff。！？；：，、）\)\]】])\s*(\d+\.)\s*(?=(\*\*|[\u4e00-\u9fffA-Za-z]))/g,
    "$1\n$2 ",
  );
  out = out.replace(/(\n\s*[-*])(?=\S)/g, "$1 ");
  out = out.replace(/(\n\s*\d+\.)(?=\S)/g, "$1 ");
  for (let i = 0; i < urls.length; i++) {
    out = out.replaceAll(`@@URL${i}@@`, urls[i]);
  }
  return out;
}
function renderMarkdownLite(text) {
  const src = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const unescaped = src
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
  const normalizedSrc = unescaped.replace(
    /(^|\n)([^*\n]+?)\s*\*\*(?=\n|$)/g,
    "$1**$2**",
  );
  const tokens = [];
  const fenceRe = /```([\w-]+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let m;
  while ((m = fenceRe.exec(normalizedSrc))) {
    const before = normalizedSrc.slice(lastIndex, m.index);
    if (before) tokens.push({ type: "text", value: before });
    tokens.push({ type: "code", lang: m[1] || "", value: m[2] || "" });
    lastIndex = m.index + m[0].length;
  }
  const tail = normalizedSrc.slice(lastIndex);
  if (tail) tokens.push({ type: "text", value: tail });
  let html = "";
  const isListBlock = (block, ordered) => {
    const lines = String(block || "").split("\n");
    let hasItem = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      const isItem = ordered
        ? /^\s*\d+\.\s+/.test(line)
        : /^\s*[-*]\s+/.test(line);
      if (isItem) {
        hasItem = true;
        continue;
      }
      if (/^\s{2,}\S/.test(line)) continue;
      return false;
    }
    return hasItem;
  };
  const isContinuationBlock = (block) => {
    const lines = String(block || "").split("\n");
    let hasIndented = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      if (/^\s{2,}\S/.test(line)) {
        hasIndented = true;
        continue;
      }
      return false;
    }
    return hasIndented;
  };
  const isSeparatorToken = (value) =>
    /^:?-{3,}:?$/.test(String(value || "").trim());
  const isTableSeparatorLine = (line) => {
    let row = String(line || "").trim();
    if (!row) return false;
    if (row.startsWith("|")) row = row.slice(1);
    if (row.endsWith("|")) row = row.slice(0, -1);
    const cells = row.split("|").map((cell) => cell.trim());
    if (!cells.length) return false;
    return cells.every((cell) => isSeparatorToken(cell));
  };
  const parseTableRow = (line) => {
    let row = String(line || "").trim();
    if (row.startsWith("|")) row = row.slice(1);
    if (row.endsWith("|")) row = row.slice(0, -1);
    return row.split("|").map((cell) => cell.trim());
  };
  const isTableBlock = (block) => {
    const lines = String(block || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return false;
    if (!lines[0].includes("|")) return false;
    return isTableSeparatorLine(lines[1]);
  };
  const splitTablesFromBlock = (block) => {
    const lines = String(block || "").split("\n");
    const segments = [];
    let buffer = [];
    const flushBuffer = () => {
      if (buffer.length) {
        segments.push(buffer.join("\n"));
        buffer = [];
      }
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed && line.includes("|")) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j += 1;
        if (j < lines.length && isTableSeparatorLine(lines[j])) {
          flushBuffer();
          const tableLines = [lines[i], lines[j]];
          i = j + 1;
          while (i < lines.length) {
            const rowLine = lines[i];
            const rowTrim = rowLine.trim();
            if (!rowTrim) {
              i += 1;
              break;
            }
            if (!rowLine.includes("|")) break;
            tableLines.push(rowLine);
            i += 1;
          }
          segments.push(tableLines.join("\n"));
          continue;
        }
      }
      buffer.push(line);
      i += 1;
    }
    flushBuffer();
    return segments;
  };
  const buildMarkdownTable = (header, rows) => {
    const headerLine = `| ${header.join(" | ")} |`;
    const sepLine = `| ${header.map(() => "---").join(" | ")} |`;
    const rowLines = rows.map((row) => `| ${row.join(" | ")} |`);
    return [headerLine, sepLine, ...rowLines].join("\n");
  };
  const parseInlineTableLine = (line) => {
    if (!line.includes("|")) return null;
    const cleaned = line
      .replace(/```[a-z0-9-]*/gi, "")
      .replace(/```/g, "")
      .trim();
    if (!cleaned.includes("|")) return null;
    let tokens = cleaned.split("|").map((item) => item.trim());
    if (tokens[0] === "") tokens = tokens.slice(1);
    if (tokens[tokens.length - 1] === "") tokens = tokens.slice(0, -1);
    if (tokens.length < 4) return null;
    const lowerFirst = String(tokens[0] || "").toLowerCase();
    if (lowerFirst === "markdown" || lowerFirst === "md") {
      tokens = tokens.slice(1);
    }
    if (tokens.length < 4) return null;
    const parseTokens = (parts, prefixCandidate) => {
      let sepStart = -1;
      for (let i = 0; i < parts.length; i++) {
        if (isSeparatorToken(parts[i])) {
          sepStart = i;
          break;
        }
      }
      if (sepStart <= 0) return null;
      let sepEnd = sepStart;
      while (sepEnd < parts.length && isSeparatorToken(parts[sepEnd])) {
        sepEnd += 1;
      }
      const header = parts.slice(0, sepStart);
      const columnCount = sepEnd - sepStart;
      if (!columnCount || header.length !== columnCount) return null;
      let prefix = prefixCandidate ? String(prefixCandidate).trim() : "";
      const firstHeader = header[0] || "";
      const colonIndex = Math.max(
        firstHeader.lastIndexOf("："),
        firstHeader.lastIndexOf(":"),
      );
      if (colonIndex > -1 && colonIndex < firstHeader.length - 1) {
        const headPrefix = firstHeader.slice(0, colonIndex + 1).trim();
        header[0] = firstHeader.slice(colonIndex + 1).trim();
        prefix = [prefix, headPrefix].filter(Boolean).join(" ");
      }
      let rest = parts.slice(sepEnd);
      if (rest.length < columnCount) return null;
      const rows = [];
      while (rest.length >= columnCount) {
        rows.push(rest.slice(0, columnCount));
        rest = rest.slice(columnCount);
      }
      const suffix = rest.join(" ").trim();
      return { prefix, table: buildMarkdownTable(header, rows), suffix };
    };
    const direct = parseTokens(tokens, "");
    if (direct) return direct;
    const prefixCandidate = tokens[0];
    const colonHint =
      prefixCandidate?.includes("：") ||
      prefixCandidate?.includes(":") ||
      /表格|资费|如下|如下表|如下图/.test(prefixCandidate || "");
    if (!colonHint) return null;
    return parseTokens(tokens.slice(1), prefixCandidate);
  };
  const expandInlineTables = (text) => {
    const lines = String(text || "").split("\n");
    const outLines = [];
    for (const line of lines) {
      const parsed = parseInlineTableLine(line);
      if (!parsed) {
        outLines.push(line);
        continue;
      }
      if (parsed.prefix) outLines.push(parsed.prefix);
      outLines.push(parsed.table);
      if (parsed.suffix) outLines.push(parsed.suffix);
    }
    return outLines.join("\n");
  };
  for (const t of tokens) {
    if (t.type === "code") {
      const codeEscaped = escapeHtml(t.value);
      html += `<pre class="md-code"><code>${codeEscaped}</code></pre>`;
      continue;
    }
    const normalized = expandInlineTables(normalizeMarkdownText(t.value));
    const rawBlocks = String(normalized).split(/\n{2,}/);
    const blocks = [];
    for (const block of rawBlocks) {
      if (!block.trim()) continue;
      const lastIdx = blocks.length - 1;
      if (lastIdx >= 0) {
        const last = blocks[lastIdx];
        if (isListBlock(last, true) && isListBlock(block, true)) {
          blocks[lastIdx] = `${last}\n${block}`;
          continue;
        }
        if (isListBlock(last, false) && isListBlock(block, false)) {
          blocks[lastIdx] = `${last}\n${block}`;
          continue;
        }
        if (isListBlock(last, true) && isContinuationBlock(block)) {
          blocks[lastIdx] = `${last}\n${block}`;
          continue;
        }
        if (isListBlock(last, false) && isContinuationBlock(block)) {
          blocks[lastIdx] = `${last}\n${block}`;
          continue;
        }
      }
      blocks.push(block);
    }
    const expandedBlocks = [];
    for (const block of blocks) {
      const segments = splitTablesFromBlock(block);
      for (const seg of segments) {
        if (seg.trim()) expandedBlocks.push(seg);
      }
    }
    for (const block of expandedBlocks) {
      const trimmed = block.trimEnd();
      if (!trimmed.trim()) continue;
      const lines = trimmed.split("\n");
      const hasHeading = lines.some((l) => /^ {0,3}(#{1,6})\s+/.test(l.trim()));
      const hasRule = lines.some((l) =>
        /^ {0,3}(-{3,}|\*{3,}|_{3,})$/.test(l.trim()),
      );
      const hasQuote = lines.some((l) => /^\s*>/.test(l));
      const isUl = isListBlock(trimmed, false);
      const isOl = isListBlock(trimmed, true);
      if (isTableBlock(trimmed)) {
        const tableLines = trimmed
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const header = parseTableRow(tableLines[0]);
        const rows = tableLines
          .slice(2)
          .map(parseTableRow)
          .filter((row) => row.length);
        const maxCols = Math.max(
          header.length,
          rows.reduce((max, row) => Math.max(max, row.length), 0),
        );
        const padRow = (row) => {
          const next = row.slice(0, maxCols);
          while (next.length < maxCols) next.push("");
          return next;
        };
        const renderRow = (cells, cellTag) => {
          const htmlCells = cells.map((cell) => {
            const content = renderInlineMarkdown(escapeHtml(cell));
            return `<${cellTag}>${content}</${cellTag}>`;
          });
          return `<tr>${htmlCells.join("")}</tr>`;
        };
        const headerRow = renderRow(padRow(header), "th");
        const bodyRows = rows
          .map((row) => renderRow(padRow(row), "td"))
          .join("");
        html += `<div class="md-table"><table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table></div>`;
      } else if (isUl) {
        html += "<ul>";
        let current = "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const mm = /^\s*[-*]\s+(.+)\s*$/.exec(line);
          if (mm) {
            if (current) {
              const item = renderInlineMarkdown(escapeHtml(current)).replace(
                /\n/g,
                "<br />",
              );
              html += `<li>${item}</li>`;
            }
            current = mm[1];
            continue;
          }
          if (/^\s{2,}\S/.test(line)) {
            current += `\n${line.replace(/^\s{2,}/, "")}`;
          }
        }
        if (current) {
          const item = renderInlineMarkdown(escapeHtml(current)).replace(
            /\n/g,
            "<br />",
          );
          html += `<li>${item}</li>`;
        }
        html += "</ul>";
      } else if (isOl) {
        html += "<ol>";
        let current = "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const mm = /^\s*\d+\.\s+(.+)\s*$/.exec(line);
          if (mm) {
            if (current) {
              const item = renderInlineMarkdown(escapeHtml(current)).replace(
                /\n/g,
                "<br />",
              );
              html += `<li>${item}</li>`;
            }
            current = mm[1];
            continue;
          }
          if (/^\s{2,}\S/.test(line)) {
            current += `\n${line.replace(/^\s{2,}/, "")}`;
          }
        }
        if (current) {
          const item = renderInlineMarkdown(escapeHtml(current)).replace(
            /\n/g,
            "<br />",
          );
          html += `<li>${item}</li>`;
        }
        html += "</ol>";
      } else if (lines.every((l) => /^\s*>/.test(l) || !l.trim())) {
        const quoted = lines
          .map((line) => line.replace(/^\s*> ?/, ""))
          .join("\n")
          .trimEnd();
        const escaped = renderInlineMarkdown(escapeHtml(quoted)).replace(
          /\n/g,
          "<br />",
        );
        html += `<blockquote><p>${escaped}</p></blockquote>`;
      } else if (hasHeading || hasRule || hasQuote) {
        let paragraph = [];
        let quoteBuffer = [];
        const flushParagraph = () => {
          if (!paragraph.length) return;
          const text = paragraph.join("\n").trimEnd();
          const escaped = renderInlineMarkdown(escapeHtml(text)).replace(
            /\n/g,
            "<br />",
          );
          html += `<p>${escaped}</p>`;
          paragraph = [];
        };
        const flushQuote = () => {
          if (!quoteBuffer.length) return;
          const text = quoteBuffer.join("\n").trimEnd();
          const escaped = renderInlineMarkdown(escapeHtml(text)).replace(
            /\n/g,
            "<br />",
          );
          html += `<blockquote><p>${escaped}</p></blockquote>`;
          quoteBuffer = [];
        };
        for (const line of lines) {
          const raw = line || "";
          const trimmedLine = raw.trim();
          if (!trimmedLine) {
            flushQuote();
            flushParagraph();
            continue;
          }
          const headingMatch = /^ {0,3}(#{1,6})\s+(.+)$/.exec(trimmedLine);
          if (headingMatch) {
            flushQuote();
            flushParagraph();
            const level = headingMatch[1].length;
            const text = headingMatch[2].trim();
            const escaped = renderInlineMarkdown(escapeHtml(text));
            html += `<h${level}>${escaped}</h${level}>`;
            continue;
          }
          if (/^ {0,3}(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
            flushQuote();
            flushParagraph();
            html += "<hr />";
            continue;
          }
          if (/^\s*>/.test(raw)) {
            flushParagraph();
            quoteBuffer.push(raw.replace(/^\s*> ?/, ""));
            continue;
          }
          flushQuote();
          paragraph.push(raw);
        }
        flushQuote();
        flushParagraph();
      } else {
        const escaped = renderInlineMarkdown(escapeHtml(trimmed)).replace(
          /\n/g,
          "<br />",
        );
        html += `<p>${escaped}</p>`;
      }
    }
  }
  return (
    html ||
    `<p>${renderInlineMarkdown(escapeHtml(src)).replace(/\n/g, "<br />")}</p>`
  );
}
async function copyToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      const ok = document.execCommand("copy");
      return ok;
    } finally {
      ta.remove();
    }
  }
}
function createEmptyStateNode() {
  const wrap = document.createElement("section");
  wrap.className = "empty";
  const card = document.createElement("div");
  card.className = "empty__card";
  const icon = document.createElement("div");
  icon.className = "empty__icon";
  icon.innerHTML = `<img src="./static/AIlogo.png" alt="AI营销助手" />`;
  const title = document.createElement("div");
  title.className = "empty__title";
  title.textContent = "你好！我是AI营销助手";
  const sub = document.createElement("div");
  sub.className = "empty__sub";
  sub.textContent = "开始对话吧～问题描述包括越多关键信息，回答越精准哈～";
  const createPromptButton = (text, className) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = text;
    btn.addEventListener("click", () => {
      setInputFromSuggestion(text);
    });
    return btn;
  };
  const prompts = document.createElement("div");
  prompts.className = "empty__prompts";
  const promptList =
    state.questionBank && state.questionBank.length
      ? state.questionBank
      : DEFAULT_QUESTION_BANK;
  promptList.slice(0, 3).forEach((text) => {
    prompts.appendChild(createPromptButton(text, "empty__prompt"));
  });
  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(sub);
  card.appendChild(prompts);
  wrap.appendChild(card);
  return { wrap };
}
function setInputFromSuggestion(text) {
  el.input.value = text;
  updateTextareaHeight();
  el.input.focus();
  state.promptSelection = { pending: true, value: text };
}
function pickRandomQuestions(list, count, exclude) {
  const pool = (list || []).filter((item) => item && item !== exclude);
  if (!pool.length) return [];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, count));
}
function clearFollowupSuggestions() {
  const existing = el.messages.querySelector(".followup");
  existing?.remove();
}
function renderFollowupSuggestions(items) {
  clearFollowupSuggestions();
  if (!items || !items.length) return;
  const wrap = document.createElement("section");
  wrap.className = "followup";
  const title = document.createElement("div");
  title.className = "followup__title";
  title.textContent = "猜你想问";
  const list = document.createElement("div");
  list.className = "followup__list";
  items.forEach((text) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "followup__item";
    btn.textContent = text;
    btn.addEventListener("click", () => setInputFromSuggestion(text));
    list.appendChild(btn);
  });
  wrap.appendChild(title);
  wrap.appendChild(list);
  el.messages.appendChild(wrap);
  if (shouldAutoScroll(el.messages)) scrollToBottom(el.messages);
}
function setBubbleContent(bubble, role, content, status) {
  if (role === "assistant") {
    bubble.classList.add("md");
    const isTyping = status === "typing";
    const thinkingHtml = `      <div class="md-typing md-typing--block" aria-live="polite">        <span class="md-typing__text">正在思考</span>        <span class="md-typing__dot">.</span>        <span class="md-typing__dot">.</span>        <span class="md-typing__dot">.</span>      </div>    `;
    if (!content) {
      bubble.innerHTML = isTyping ? thinkingHtml : "";
      return;
    }
    const body = renderMarkdownLite(content || "");
    bubble.innerHTML = isTyping
      ? `${body}
${thinkingHtml}`
      : body;
  } else {
    bubble.classList.remove("md");
    bubble.textContent = content || "";
  }
}
function createMessageNode(message) {
  const { role, content, time, status } = message;
  const wrap = document.createElement("section");
  wrap.className = `msg ${role === "user" ? "msg--user" : "msg--assistant"}`;
  const avatar = document.createElement("div");
  avatar.className = `msg__avatar ${role === "user" ? "msg__avatar--user" : "msg__avatar--assistant"}`;
  avatar.textContent = "";
  avatar.setAttribute("aria-hidden", "true");
  const contentWrap = document.createElement("div");
  contentWrap.className = "msg__content";
  const bubble = document.createElement("div");
  bubble.className = "msg__bubble";
  setBubbleContent(bubble, role, content || "", status);
  const meta = document.createElement("div");
  meta.className = "msg__meta";
  const tag = document.createElement("span");
  tag.className = "msg__tag";
  tag.textContent = role === "user" ? "你" : "机器人";
  const t = document.createElement("span");
  t.textContent = time || "";
  meta.appendChild(tag);
  meta.appendChild(t);
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "msg__action";
  copyBtn.textContent = "复制";
  copyBtn.addEventListener("click", async () => {
    const ok = await copyToClipboard(bubble.textContent || "");
    setTips(ok ? "已复制" : "复制失败");
    setTimeout(() => setTips(""), 900);
  });
  meta.appendChild(copyBtn);
  if (role === "assistant") {
    const likeBtn = document.createElement("button");
    likeBtn.type = "button";
    likeBtn.className = "msg__action";
    likeBtn.textContent = "点赞";
    likeBtn.setAttribute("data-feedback", "like");
    likeBtn.addEventListener("click", async () => {
      if (message.feedback) return;
      try {
        await sendFeedback(message, "like");
        message.feedback = "like";
        updateFeedbackState(meta, message.feedback, message.status);
        setTips("感谢反馈");
      } catch (err) {
        setTips(`反馈失败：${String(err?.message || err)}`);
      } finally {
        setTimeout(() => setTips(""), 1200);
      }
    });
    meta.appendChild(likeBtn);
    const dislikeBtn = document.createElement("button");
    dislikeBtn.type = "button";
    dislikeBtn.className = "msg__action";
    dislikeBtn.textContent = "点踩";
    dislikeBtn.setAttribute("data-feedback", "dislike");
    dislikeBtn.addEventListener("click", async () => {
      if (message.feedback) return;
      const reason = window.prompt("请输入原因");
      if (reason === null) return;
      const trimmed = reason.trim();
      if (!trimmed) {
        setTips("请填写原因");
        setTimeout(() => setTips(""), 1200);
        return;
      }
      try {
        await sendFeedback(message, "dislike", trimmed);
        message.feedback = "dislike";
        updateFeedbackState(meta, message.feedback, message.status);
        setTips("已提交反馈");
      } catch (err) {
        setTips(`反馈失败：${String(err?.message || err)}`);
      } finally {
        setTimeout(() => setTips(""), 1200);
      }
    });
    meta.appendChild(dislikeBtn);
  }
  if (status === "typing") {
    const spinner = document.createElement("span");
    spinner.className = "msg__spinner";
    spinner.title = "生成中";
    meta.appendChild(spinner);
  }
  if (role === "assistant") {
    updateFeedbackState(meta, message.feedback, status);
  }
  contentWrap.appendChild(bubble);
  contentWrap.appendChild(meta);
  if (role === "user") {
    wrap.appendChild(contentWrap);
    wrap.appendChild(avatar);
  } else {
    wrap.appendChild(avatar);
    wrap.appendChild(contentWrap);
  }
  return { wrap, bubble, meta };
}
function renderAll() {
  el.messages.innerHTML = "";
  const conv = getActiveConversation();
  if (!conv.messages.length) {
    el.messages.appendChild(createEmptyStateNode().wrap);
    updateScrollButton();
    return;
  }
  for (const m of conv.messages) {
    const node = createMessageNode(m);
    el.messages.appendChild(node.wrap);
  }
  scrollToBottom(el.messages);
}
function openSettings() {
  closeChatList();
  if (el.baseUrl) el.baseUrl.value = state.config.baseUrl;
  if (el.apiKey) el.apiKey.value = state.config.apiKey;
  if (el.userId) el.userId.value = state.config.userId;
  if (el.responseMode) el.responseMode.value = state.config.responseMode;
  if (el.platform) el.platform.value = "agent";
  updatePlatformUI();
  updateUserInfoDisplay();
  updateAuthDisplay();
  el.modal.setAttribute("aria-hidden", "false");
  setTimeout(() => el.userId?.focus(), 0);
}
function closeSettings() {
  el.modal.setAttribute("aria-hidden", "true");
}
function updateTextareaHeight() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, window.innerHeight * 0.4)}
px`;
}
function updatePlatformUI() {
  if (el.platform) {
    el.platform.value = "agent";
  }
  if (el.apiKeyField) {
    el.apiKeyField.style.display = "none";
  }
  if (el.responseModeField) {
    el.responseModeField.style.display = "none";
  }
  if (el.baseUrl) {
    const base = normalizeBaseUrl(el.baseUrl.value);
    if (!isProxyBaseUrl(base)) {
      el.baseUrl.value = "/api";
    }
  }
}
const imageViewerState = { scale: 1, baseScale: 1, startDist: 0 };
function setImageScale(scale) {
  imageViewerState.scale = Math.max(1, Math.min(3, scale));
  el.imageViewerImg.style.transform = `scale(${imageViewerState.scale})`;
}
function getTouchDistance(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}
function openImageViewer(src, alt) {
  if (!el.imageViewer || !el.imageViewerImg) return;
  el.imageViewerImg.src = src;
  el.imageViewerImg.alt = alt || "图片预览";
  setImageScale(1);
  el.imageViewer.setAttribute("aria-hidden", "false");
}
function closeImageViewer() {
  if (!el.imageViewer || !el.imageViewerImg) return;
  el.imageViewer.setAttribute("aria-hidden", "true");
  el.imageViewerImg.src = "";
  setImageScale(1);
}
function updateVhVar() {
  const h = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty(
    "--vh",
    `${h * 0.01}
px`,
  );
}
function getUserMeta() {
  const info = state.platformUser || {};
  const userName = String(
    info.userName || info.name || info.username || "",
  ).trim();
  const org = String(
    info.org || info.departmentName || info.orgName || "",
  ).trim();
  const phone = String(info.phone || info.mobile || "").trim();
  return {
    userName: userName || DEFAULT_USER_META.userName,
    org: org || DEFAULT_USER_META.org,
    phone: phone || DEFAULT_USER_META.phone,
  };
}
function updateUserInfoDisplay() {
  if (!el.userInfoName && !el.userInfoPhone && !el.userInfoOrg) return;
  const info = state.platformUser || {};
  const nameRaw = String(
    info.userName || info.name || info.username || "",
  ).trim();
  const orgRaw = String(
    info.org || info.departmentName || info.orgName || "",
  ).trim();
  const phoneRaw = String(info.phone || info.mobile || "").trim();
  const nameText = nameRaw || `${DEFAULT_USER_META.userName}（默认）`;
  const orgText = orgRaw || `${DEFAULT_USER_META.org}（默认）`;
  const phoneText = phoneRaw || `${DEFAULT_USER_META.phone}（默认）`;
  if (el.userInfoName) el.userInfoName.textContent = nameText;
  if (el.userInfoOrg) el.userInfoOrg.textContent = orgText;
  if (el.userInfoPhone) el.userInfoPhone.textContent = phoneText;
}
function updateAuthDisplay() {
  if (
    !el.authCodeValue &&
    !el.authStateValue &&
    !el.authAccessTokenValue &&
    !el.authRefreshTokenValue
  ) {
    return;
  }
  const auth = state.auth || {
    code: "",
    state: "",
    accessToken: "",
    refreshToken: "",
    tokenType: "",
    expiresIn: 0,
    receivedAt: 0,
  };
  const codeText = auth.code ? auth.code : "-";
  const stateText = auth.state ? auth.state : "-";
  const accessText = auth.accessToken ? auth.accessToken : "-";
  const refreshText = auth.refreshToken ? auth.refreshToken : "-";
  if (el.authCodeValue) el.authCodeValue.textContent = codeText;
  if (el.authStateValue) el.authStateValue.textContent = stateText;
  if (el.authAccessTokenValue) el.authAccessTokenValue.textContent = accessText;
  if (el.authRefreshTokenValue)
    el.authRefreshTokenValue.textContent = refreshText;
}
async function fetchAuthConfig() {
  const url = `${getStoreBase()}/auth-config`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "auth config failed");
  }
  return res.json().catch(() => ({}));
}
async function exchangeAuthToken(code, redirectUri) {
  const url = `${getStoreBase()}/auth-token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirectUri }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "token request failed");
  }
  return res.json().catch(() => ({}));
}
async function fetchAuthUserInfo(accessToken) {
  const url = `${getStoreBase()}/auth-userinfo`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = JSON.parse(text || "{}");
  } catch {
    data = null;
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorCode: data?.errorCode ?? null,
      message:
        data?.error || text || res.statusText || "userinfo request failed",
      data,
    };
  }
  return { ok: true, status: res.status, data };
}
function applyUserInfoFromResponse(userInfo) {
  const name = String(userInfo?.name || "").trim();
  const phone = String(userInfo?.phone_number || "").trim();
  const org = String(userInfo?.orgName || "").trim();
  state.platformUser = { userName: name, phone, org, raw: userInfo || {} };
  updateUserInfoDisplay();
  if (phone) {
    state.config.userId = phone;
    saveConfig(state.config);
    updateConversationList();
  }
}
async function tryLoginWithStoredToken() {
  const accessToken = String(state.auth?.accessToken || "");
  if (!accessToken) {
    return { ok: false, needsAuth: false, reason: "missing_token" };
  }
  const result = await fetchAuthUserInfo(accessToken);
  if (result.ok) {
    applyUserInfoFromResponse(result.data || {});
    return { ok: true, needsAuth: false };
  }
  if (result.status !== 200 && result.errorCode === 10011) {
    return { ok: false, needsAuth: true, reason: "token_expired" };
  }
  setTips(`获取用户信息失败：${String(result.message || "")}`);
  return { ok: false, needsAuth: false, reason: "other_error" };
}
async function startAuthFlow() {
  try {
    const cfg = await fetchAuthConfig();
    const authorizeUrlBase = String(cfg?.authorizeUrlBase || "").trim();
    const clientId = String(cfg?.clientId || "").trim();
    const redirectUri = String(cfg?.redirectUri || "").trim();
    const scope = String(cfg?.scope || "").trim();
    if (!authorizeUrlBase || !clientId || !redirectUri || !scope) {
      setTips("认证配置不完整，请检查环境变量。");
      return;
    }
    const stateValue = `state-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
    state.auth = {
      code: "",
      state: stateValue,
      accessToken: "",
      refreshToken: "",
      tokenType: "",
      expiresIn: 0,
      receivedAt: 0,
    };
    saveAuthState(state.auth);
    updateAuthDisplay();
    const url = new URL(authorizeUrlBase);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", stateValue);
    window.location.href = url.toString();
  } catch (err) {
    setTips(`认证失败：${String(err?.message || err)}`);
  }
}
function captureAuthCodeFromUrl() {
  const params = new URLSearchParams(window.location.search || "");
  const code = params.get("code");
  const returnedState = params.get("state");
  if (!code) return false;
  const expectedState = String(state.auth?.state || "");
  if (expectedState && returnedState && expectedState !== returnedState) {
    // eslint-disable-next-line no-console
    console.warn("[Auth] state mismatch", { expectedState, returnedState });
    state.auth = { ...state.auth, code: "", state: "", receivedAt: 0 };
    saveAuthState(state.auth);
    updateAuthDisplay();
    return false;
  }
  state.auth = {
    ...state.auth,
    code,
    state: returnedState || expectedState || "",
    receivedAt: Date.now(),
  };
  const cleanUrl = `${window.location.pathname}
${window.location.hash || ""}`;
  window.history.replaceState({}, "", cleanUrl);
  fetchAuthConfig()
    .then((cfg) => String(cfg?.redirectUri || "").trim())
    .then((redirectUri) => exchangeAuthToken(code, redirectUri))
    .then((data) => {
      const accessToken = String(data?.access_token || "");
      const refreshToken = String(data?.refresh_token || "");
      state.auth = {
        ...state.auth,
        accessToken,
        refreshToken,
        tokenType: String(data?.token_type || ""),
        expiresIn: Number(data?.expires_in || 0),
        receivedAt: Date.now(),
      };
      saveAuthState(state.auth);
      updateAuthDisplay();
      if (!accessToken) {
        throw new Error("empty access_token");
      }
      return fetchAuthUserInfo(accessToken).then((result) => {
        if (!result.ok) {
          throw new Error(`userinfo:${String(result.message || "failed")}`);
        }
        return result.data || {};
      });
    })
    .then((userInfo) => {
      applyUserInfoFromResponse(userInfo);
    })
    .catch((err) => {
      const message = String(err?.message || err);
      if (message.startsWith("userinfo:")) {
        setTips(`获取用户信息失败：${message.slice("userinfo:".length)}`);
      } else {
        setTips(`换取 token 失败：${message}`);
      }
      updateAuthDisplay();
    });
  saveAuthState(state.auth);
  updateAuthDisplay();
  return true;
}
async function createAgentThread(title) {
  const url = `${getStoreBase()}/alt-thread`;
  const payload = {
    title: String(title || "新对话"),
    agent_id: AGENT_ID,
    metadata: getUserMeta(),
  };
  console.log("[Chatbot] create thread payload:", payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `创建对话失败（${res.status}）：${txt || res.statusText || "Unknown error"}`,
    );
  }
  const data = await res.json().catch(() => ({}));
  const threadId = String(data?.id || "");
  if (!threadId) {
    throw new Error("创建对话失败：未返回对话 ID");
  }
  return threadId;
}
async function agentChat({ query, signal, threadId }) {
  const url = `${getStoreBase()}/alt-chat`;
  const config = { thread_id: threadId || null };
  const payload = { query, config };
  console.log("[Chatbot] chat payload:", payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `请求失败（${res.status}）：${txt || res.statusText || "Unknown error"}`,
    );
  }
  const data = await res.json().catch(() => ({}));
  return {
    answer: String(data?.answer || data?.message || data?.content || ""),
    externalMessageId: String(data?.externalMessageId || ""),
  };
}
async function agentChatStream({ query, signal, onDelta, onMeta, threadId }) {
  const url = `${getStoreBase()}/alt-chat-stream`;
  const config = { thread_id: threadId || null };
  const payload = { query, config };
  console.log("[Chatbot] chat stream payload:", payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `请求失败（${res.status}）：${txt || res.statusText || "Unknown error"}`,
    );
  }
  let sawChunk = false;
  const handlePayload = (data) => {
    if (!data || typeof data !== "object") return;
    if (data.event === "meta") {
      const messageId = data.messageId ?? data.externalMessageId;
      if (messageId !== undefined && messageId !== null) {
        onMeta?.(String(messageId));
      }
      return;
    }
    const messageId = data.messageId ?? data.externalMessageId;
    if (messageId !== undefined && messageId !== null) {
      onMeta?.(String(messageId));
    }
    const event = String(data.event || "");
    const chunk = String(data.answer || data.content || data.message || "");
    if (!chunk) return;
    if (event && event !== "message") return;
    sawChunk = true;
    onDelta?.(chunk);
  };
  const handleFrame = (frame) => {
    const lines = frame.split("\n").filter(Boolean);
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    const dataRaw = dataLines.length ? dataLines.join("\n").trim() : frame.trim();
    if (!dataRaw || dataRaw === "[DONE]") return;
    const data = safeJsonParse(dataRaw, null);
    if (data) {
      handlePayload(data);
      return;
    }
    const stripped = dataRaw
      .replace(/^event:.*$/gim, "")
      .replace(/^data:\s*/gim, "")
      .trim();
    if (!stripped || stripped === "[DONE]") return;
    sawChunk = true;
    onDelta?.(stripped);
  };
  const handleTextResponse = (text) => {
    const normalized = String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    if (!normalized.trim()) return;
    const frames = normalized.split("\n\n");
    for (const frame of frames) {
      if (frame.trim()) handleFrame(frame);
    }
    if (!sawChunk && normalized.trim()) {
      onDelta?.(normalized.trim());
    }
  };
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text().catch(() => "");
    handleTextResponse(text);
    return;
  }
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (frame.trim()) handleFrame(frame);
    }
  }
  if (buffer.trim()) {
    handleFrame(buffer);
  }
}
function setBusy(busy) {
  el.sendBtn.disabled = busy;
  el.stopBtn.hidden = !busy;
}
function updateScrollButton() {
  const show = !shouldAutoScroll(el.messages);
  el.scrollBtn.hidden = !show;
}
async function sendMessage() {
  if (state.inFlight) return;
  const text = String(el.input.value || "").trim();
  if (!text) return;
  const fromSuggestion =
    state.promptSelection?.pending && state.promptSelection.value === text;
  state.promptSelection = { pending: false, value: "" };
  clearFollowupSuggestions();
  if (!isConfigured(state.config)) {
    setTips("请先在“设置”里填写配置。");
    openSettings();
    return;
  }
  setTips("");
  el.input.value = "";
  updateTextareaHeight();
  const conv = getActiveConversation();
  const autoScroll = shouldAutoScroll(el.messages);
  if (!conv.messages.length) {
    el.messages.innerHTML = "";
  }
  if (!conv.platform) {
    conv.platform = "agent";
  }
  conv.messages.push({ role: "user", content: text, time: nowTime() });
  conv.updatedAt = Date.now();
  if (conv.title === "新对话") {
    conv.title = deriveTitleFromMessages(conv.messages);
  }
  if (!conv.conversationId) {
    try {
      conv.conversationId = await createAgentThread(conv.title);
      conv.updatedAt = Date.now();
      saveConversations();
      updateConversationList();
    } catch (err) {
      setTips(String(err?.message || err));
    }
  }
  const userNode = createMessageNode(conv.messages[conv.messages.length - 1]);
  el.messages.appendChild(userNode.wrap);
  const assistantMsg = {
    role: "assistant",
    content: "",
    time: nowTime(),
    status: "typing",
    feedback: "",
    externalMessageId: "",
  };
  conv.messages.push(assistantMsg);
  conv.updatedAt = Date.now();
  const assistantNode = createMessageNode(assistantMsg);
  el.messages.appendChild(assistantNode.wrap);
  if (autoScroll) scrollToBottom(el.messages);
  updateScrollButton();
  saveConversations();
  updateConversationList();
  const controller = new AbortController();
  state.inFlight = controller;
  setBusy(true);
  try {
    if (!conv.conversationId) {
      throw new Error("无法创建对话 ID");
    }
    await agentChatStream({
      query: text,
      signal: controller.signal,
      threadId: conv.conversationId,
      onMeta: (messageId) => {
        if (!assistantMsg.externalMessageId && messageId) {
          assistantMsg.externalMessageId = String(messageId);
          saveConversations();
        }
      },
      onDelta: (chunk) => {
        assistantMsg.content += chunk;
        setBubbleContent(
          assistantNode.bubble,
          "assistant",
          assistantMsg.content,
          assistantMsg.status,
        );
        if (autoScroll) scrollToBottom(el.messages);
        updateScrollButton();
      },
    });
    assistantMsg.status = "done";
    assistantNode.meta.querySelector(".msg__spinner")?.remove();
    setBubbleContent(
      assistantNode.bubble,
      "assistant",
      assistantMsg.content,
      assistantMsg.status,
    );
    updateFeedbackState(
      assistantNode.meta,
      assistantMsg.feedback,
      assistantMsg.status,
    );
    updateScrollButton();
    conv.updatedAt = Date.now();
    if (conv.title === "新对话") {
      conv.title = deriveTitleFromMessages(conv.messages);
    }
    saveConversations();
    updateConversationList();
    if (fromSuggestion) {
      const pool = state.questionBank.length
        ? state.questionBank
        : DEFAULT_QUESTION_BANK;
      const next = pickRandomQuestions(pool, 3, text);
      renderFollowupSuggestions(next);
    }
  } catch (err) {
    if (err?.name === "AbortError") {
      assistantMsg.status = "done";
      assistantMsg.content = assistantMsg.content || "（已停止）";
      setBubbleContent(
        assistantNode.bubble,
        "assistant",
        assistantMsg.content,
        assistantMsg.status,
      );
      assistantNode.meta.querySelector(".msg__spinner")?.remove();
      updateFeedbackState(
        assistantNode.meta,
        assistantMsg.feedback,
        assistantMsg.status,
      );
      updateScrollButton();
      conv.updatedAt = Date.now();
      saveConversations();
      updateConversationList();
      setTips("已停止。");
    } else {
      assistantMsg.status = "error";
      assistantMsg.content =
        assistantMsg.content || `出错：${String(err?.message || err)}`;
      setBubbleContent(
        assistantNode.bubble,
        "assistant",
        assistantMsg.content,
        assistantMsg.status,
      );
      assistantNode.meta.querySelector(".msg__spinner")?.remove();
      updateFeedbackState(
        assistantNode.meta,
        assistantMsg.feedback,
        assistantMsg.status,
      );
      updateScrollButton();
      conv.updatedAt = Date.now();
      saveConversations();
      updateConversationList();
      setTips(
        isProxyBaseUrl(state.config.baseUrl)
          ? "请求失败：请检查代理服务是否已启动。"
          : "请求失败：请检查 Base URL / CORS。",
      );
    }
  } finally {
    state.inFlight = null;
    setBusy(false);
    setConnHint();
  }
}
function stopGeneration() {
  if (!state.inFlight) return;
  state.inFlight.abort();
  setTips("正在停止...");
}
function resetConversation(options) {
  const silent = Boolean(options?.silent);
  const conv = getActiveConversation();
  conv.conversationId = "";
  conv.updatedAt = Date.now();
  saveConversations();
  updateConversationList();
  if (!silent) {
    setTips("conversation_id 已重置。");
  }
  setConnHint();
}
function clearChat() {
  const conv = getActiveConversation();
  conv.messages = [];
  conv.conversationId = "";
  conv.updatedAt = Date.now();
  if (!conv.title || conv.title === "新对话") {
    conv.title = "新对话";
  }
  saveConversations();
  renderAll();
  updateScrollButton();
  updateConversationList();
  setTips("聊天已清空。");
}
function clearChatWithConfirm() {
  if (state.inFlight) stopGeneration();
  const conv = getActiveConversation();
  if (!conv.messages.length) return;
  if (!window.confirm("确定要清空当前对话吗？")) return;
  resetConversation({ silent: true });
  clearChat();
}
function newChat() {
  const conv = createConversation({ platform: "agent" });
  state.conversations.unshift(conv);
  state.activeId = conv.id;
  saveConversations();
  renderAll();
  updateScrollButton();
  updateConversationList();
} // Events
el.sendBtn.addEventListener("click", sendMessage);
el.stopBtn.addEventListener("click", stopGeneration);
el.newChatBtn.addEventListener("click", newChat);
el.scrollBtn.addEventListener("click", () => {
  scrollToBottom(el.messages);
  updateScrollButton();
});
el.messages.addEventListener("scroll", updateScrollButton, { passive: true });
el.chatListBtn.addEventListener("click", openChatList);
el.closeChatListBtn.addEventListener("click", closeChatList);
el.chatListBackdrop.addEventListener("click", closeChatList);
el.newChatFromListBtn.addEventListener("click", () => {
  newChat();
  closeChatList();
});
el.input.addEventListener("input", updateTextareaHeight);
el.input.addEventListener("keydown", (e) => {
  if (IS_MOBILE) return;
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
el.settingsBtn.addEventListener("click", openSettings);
el.authStartBtn?.addEventListener("click", startAuthFlow);
el.closeSettingsBtn.addEventListener("click", closeSettings);
el.backdrop.addEventListener("click", closeSettings);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeSettings();
    closeChatList();
    closeImageViewer();
  }
});
el.settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const cfg = {
    baseUrl: el.baseUrl?.value || "/api",
    apiKey: el.apiKey?.value || "",
    userId: el.userId?.value || randomId("user"),
    responseMode: el.responseMode?.value || "streaming",
    platform: el.platform?.value || "agent",
  };
  const platform = "agent";
  const baseUrl = normalizeBaseUrl(cfg.baseUrl);
  const finalBaseUrl = !isProxyBaseUrl(baseUrl) ? "/api" : baseUrl;
  state.config = {
    baseUrl: finalBaseUrl,
    apiKey: String(cfg.apiKey || "").trim(),
    userId: String(cfg.userId || "").trim(),
    responseMode: "streaming",
    platform,
  };
  saveConfig(state.config);
  setConnHint();
  setTips(isConfigured(state.config) ? "已保存。" : "请补全配置。");
  closeSettings();
});
el.resetConversationBtn.addEventListener("click", resetConversation);
el.clearChatBtn.addEventListener("click", clearChatWithConfirm);
el.platform.addEventListener("change", updatePlatformUI);
el.imageViewerBackdrop.addEventListener("click", closeImageViewer);
el.imageViewerContent.addEventListener("click", (e) => {
  if (e.target === el.imageViewerContent) closeImageViewer();
});
el.messages.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLImageElement)) return;
  if (!target.closest(".md")) return;
  openImageViewer(target.src, target.alt || "图片预览");
});
el.imageViewerImg.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 2) return;
  imageViewerState.startDist = getTouchDistance(e.touches[0], e.touches[1]);
  imageViewerState.baseScale = imageViewerState.scale;
});
el.imageViewerImg.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const dist = getTouchDistance(e.touches[0], e.touches[1]);
    if (!imageViewerState.startDist) return;
    const next =
      imageViewerState.baseScale * (dist / imageViewerState.startDist);
    setImageScale(next);
  },
  { passive: false },
);
el.imageViewerImg.addEventListener("touchend", () => {
  if (imageViewerState.scale < 1) setImageScale(1);
  if (imageViewerState.scale > 3) setImageScale(3);
}); // Init
updateVhVar();
window.visualViewport?.addEventListener("resize", updateVhVar);
window.addEventListener("resize", updateVhVar);
el.input.placeholder = "询问任何问题";
if (IS_MOBILE) {
  el.input.setAttribute("enterkeyhint", "done");
} else {
  el.input.setAttribute("enterkeyhint", "send");
}
async function bootstrap() {
  await initPlatformUser();
  const hasAuthCode = captureAuthCodeFromUrl();
  await loadQuestionBank();
  setConnHint();
  renderAll();
  updateTextareaHeight();
  updateScrollButton();
  updateConversationList();
  updateUserInfoDisplay();
  updateAuthDisplay();
  if (!hasAuthCode) {
    const result = await tryLoginWithStoredToken();
    if (result.needsAuth) {
      setTips("认证失效，正在重新认证...");
      startAuthFlow();
      return;
    }
  }
  await initConversations();
  if (!isConfigured(state.config)) {
    // first visit: guide to settings quickly
    setTimeout(openSettings, 200);
  }
}
bootstrap();

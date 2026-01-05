import { getLoginUserInfo } from "./platform-bridge.js";

const STORAGE_KEY = "h5ChatbotConfig:v1";
const LEGACY_CHAT_KEY = "h5ChatbotChat:v1";
const AGENT_ID = "ChatbotAgent";
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
  const saved = safeJsonParse(localStorage.getItem(STORAGE_KEY) || "null", null);
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
}

// Choose a stable identifier for server-side conversation storage.
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
  const text = String(first?.content || "").trim().replace(/\s+/g, " ");
  if (!text) return "新对话";
  return text.length > 18 ? `${text.slice(0, 18)}…` : text;
}

function normalizeConversation(item) {
  const now = Date.now();
  const messages = Array.isArray(item?.messages) ? item.messages : [];
  const platform = "agent";
  const title = String(item?.title || "").trim() || deriveTitleFromMessages(messages);
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
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "load conversations failed");
  }
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items.map(normalizeConversation) : [];
  const preferredId = String(data?.activeId || "");
  const activeId = items.some((c) => c.id === preferredId) ? preferredId : items[0]?.id || "";
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

const state = {
  config: initialConfig,
  conversations: [initialConversation],
  activeId: initialConversation.id,
  inFlight: null,
  platformUser: null,
};

const IS_MOBILE = (() => {
  const ua = navigator.userAgent || "";
  const touch = navigator.maxTouchPoints || 0;
  return /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(ua) || touch > 1;
})();

// Try to sync userId from the platform SDK before loading conversations.
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

  const legacy = safeJsonParse(localStorage.getItem(LEGACY_CHAT_KEY) || "null", null);
  if (legacy) {
    localStorage.removeItem(LEGACY_CHAT_KEY);
  }
}

function isConfigured(cfg) {
  if (!cfg.userId) return false;
  return true;
}

function setTips(text) {
  el.tips.textContent = text || "";
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
  return container.scrollHeight - (container.scrollTop + container.clientHeight) < threshold;
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

  const pushPlaceholder = (html) => {
    const i = placeholders.length;
    placeholders.push(html);
    return token(i);
  };

  out = out.replace(/!\[([^\]]*)\]\s*\(\s*(https?:\/\/[^\s)]+)\s*\)/g, (_, alt, url) => {
    return pushPlaceholder(
      `<img src="${url}" alt="${alt}" loading="lazy" decoding="async" />`,
    );
  });

  out = out.replace(/`([^`\n]+)`/g, (_, code) => {
    return pushPlaceholder(`<code class="md-inline">${code}</code>`);
  });

  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => {
    return pushPlaceholder(
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`,
    );
  });

  out = out.replace(/(https?:\/\/[^\s<]+[^\s<\.)])/g, (url) => {
    if (isImageUrl(url)) {
      return pushPlaceholder(`<img src="${url}" alt="image" loading="lazy" decoding="async" />`);
    }
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
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
  out = out.replace(/([^\n])\s*(#{1,6})\s*(?=\S)/g, "$1\n$2 ");
  out = out.replace(/([:：。！？!?.])\s*([-*])\s+(?=\S)/g, "$1\n$2 ");
  out = out.replace(/([:：。！？!?.])\s*(\d+\.)\s+(?=\S)/g, "$1\n$2 ");
  out = out.replace(/([\u4e00-\u9fff。！？；：，、）\)\]】])\s*-\s*(?=\S)/g, "$1\n- ");
  out = out.replace(
    /([\u4e00-\u9fff。！？；：，、）\)\]】])\s*(\d+\.)\s*(?=(\*\*|[\u4e00-\u9fffA-Za-z]))/g,
    "$1\n$2 ",
  );
  out = out.replace(/(\n\s*[-*])(?=\S)/g, "$1 ");
  out = out.replace(/(\n\s*\d+\.)(?=\S)/g, "$1 ");
  return out;
}

function renderMarkdownLite(text) {
  const src = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const tokens = [];

  const fenceRe = /```([\w-]+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let m;
  while ((m = fenceRe.exec(src))) {
    const before = src.slice(lastIndex, m.index);
    if (before) tokens.push({ type: "text", value: before });
    tokens.push({ type: "code", lang: m[1] || "", value: m[2] || "" });
    lastIndex = m.index + m[0].length;
  }
  const tail = src.slice(lastIndex);
  if (tail) tokens.push({ type: "text", value: tail });

  let html = "";

  const isListBlock = (block, ordered) => {
    const lines = String(block || "").split("\n");
    let hasItem = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      const isItem = ordered ? /^\s*\d+\.\s+/.test(line) : /^\s*[-*]\s+/.test(line);
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

  const isSeparatorToken = (value) => /^:?-{3,}:?$/.test(String(value || "").trim());

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
    const cleaned = line.replace(/```[a-z0-9-]*/gi, "").replace(/```/g, "").trim();
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
      const colonIndex = Math.max(firstHeader.lastIndexOf("："), firstHeader.lastIndexOf(":"));
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
      /表格|资费|如下|如下|如下表|如下为/.test(prefixCandidate || "");
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
      const hasRule = lines.some((l) => /^ {0,3}(-{3,}|\*{3,}|_{3,})$/.test(l.trim()));
      const hasQuote = lines.some((l) => /^\s*>/.test(l));

      const isUl = isListBlock(trimmed, false);
      const isOl = isListBlock(trimmed, true);

      if (isTableBlock(trimmed)) {
        const tableLines = trimmed
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const header = parseTableRow(tableLines[0]);
        const rows = tableLines.slice(2).map(parseTableRow).filter((row) => row.length);
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
        const bodyRows = rows.map((row) => renderRow(padRow(row), "td")).join("");
        html += `<div class="md-table"><table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table></div>`;
      } else if (isUl) {
        html += "<ul>";
        let current = "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const mm = /^\s*[-*]\s+(.+)\s*$/.exec(line);
          if (mm) {
            if (current) {
              const item = renderInlineMarkdown(escapeHtml(current)).replace(/\n/g, "<br />");
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
          const item = renderInlineMarkdown(escapeHtml(current)).replace(/\n/g, "<br />");
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
              const item = renderInlineMarkdown(escapeHtml(current)).replace(/\n/g, "<br />");
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
          const item = renderInlineMarkdown(escapeHtml(current)).replace(/\n/g, "<br />");
          html += `<li>${item}</li>`;
        }
        html += "</ol>";
      } else if (lines.every((l) => /^\s*>/.test(l) || !l.trim())) {
        const quoted = lines
          .map((line) => line.replace(/^\s*> ?/, ""))
          .join("\n")
          .trimEnd();
        const escaped = renderInlineMarkdown(escapeHtml(quoted)).replace(/\n/g, "<br />");
        html += `<blockquote><p>${escaped}</p></blockquote>`;
      } else if (hasHeading || hasRule || hasQuote) {
        let paragraph = [];
        let quoteBuffer = [];

        const flushParagraph = () => {
          if (!paragraph.length) return;
          const text = paragraph.join("\n").trimEnd();
          const escaped = renderInlineMarkdown(escapeHtml(text)).replace(/\n/g, "<br />");
          html += `<p>${escaped}</p>`;
          paragraph = [];
        };

        const flushQuote = () => {
          if (!quoteBuffer.length) return;
          const text = quoteBuffer.join("\n").trimEnd();
          const escaped = renderInlineMarkdown(escapeHtml(text)).replace(/\n/g, "<br />");
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
        const escaped = renderInlineMarkdown(escapeHtml(trimmed)).replace(/\n/g, "<br />");
        html += `<p>${escaped}</p>`;
      }
    }
  }

  return html || `<p>${renderInlineMarkdown(escapeHtml(src)).replace(/\n/g, "<br />")}</p>`;
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
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 2a1 1 0 0 1 .94.66l1.1 3.13a9.2 9.2 0 0 1 3.1 1.8l3.14-1.1a1 1 0 0 1 1.24.55l.02.05a1 1 0 0 1-.26 1.1l-2.44 2.26c.34.97.52 1.98.54 3.02l2.73 1.2a1 1 0 0 1 .48 1.3l-.02.05a1 1 0 0 1-1 .63l-3.32-.23a9.24 9.24 0 0 1-2.13 2.47l.72 3.25a1 1 0 0 1-.7 1.18l-.05.01a1 1 0 0 1-1.09-.38L12 20.5l-2.46 2.29a1 1 0 0 1-1.09.38l-.05-.01a1 1 0 0 1-.7-1.18l.72-3.25a9.24 9.24 0 0 1-2.13-2.47l-3.32.23a1 1 0 0 1-1-.63l-.02-.05a1 1 0 0 1 .48-1.3l2.73-1.2c.02-1.04.2-2.05.54-3.02L3.24 8.19A1 1 0 0 1 2.98 7.1l.02-.05a1 1 0 0 1 1.24-.55l3.14 1.1a9.2 9.2 0 0 1 3.1-1.8l1.1-3.13A1 1 0 0 1 12 2Zm0 6.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" />
    </svg>
  `;

  const title = document.createElement("div");
  title.className = "empty__title";
  title.textContent = "你好！我是 AI 助手";

  const sub = document.createElement("div");
  sub.className = "empty__sub";
  sub.textContent = "开始对话吧～试试询问任何问题。";

  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(sub);
  wrap.appendChild(card);
  return { wrap };
}

function setBubbleContent(bubble, role, content) {
  if (role === "assistant") {
    bubble.classList.add("md");
    if (!content) {
      bubble.innerHTML = `
        <span class="md-typing" aria-live="polite">
          <span class="md-typing__text">正在思考</span>
          <span class="md-typing__dot">.</span>
          <span class="md-typing__dot">.</span>
          <span class="md-typing__dot">.</span>
        </span>
      `;
      return;
    }
    bubble.innerHTML = renderMarkdownLite(content || "");
  } else {
    bubble.classList.remove("md");
    bubble.textContent = content || "";
  }
}

function createMessageNode({ role, content, time, status }) {
  const wrap = document.createElement("section");
  wrap.className = `msg ${role === "user" ? "msg--user" : "msg--assistant"}`;

  const avatar = document.createElement("div");
  avatar.className = "msg__avatar";
  avatar.textContent = role === "user" ? "你" : "AI";
  avatar.setAttribute("aria-hidden", "true");

  const contentWrap = document.createElement("div");
  contentWrap.className = "msg__content";

  const bubble = document.createElement("div");
  bubble.className = "msg__bubble";
  setBubbleContent(bubble, role, content || "");

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

  if (status === "typing") {
    const spinner = document.createElement("span");
    spinner.className = "msg__spinner";
    spinner.title = "生成中";
    meta.appendChild(spinner);
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
  el.modal.setAttribute("aria-hidden", "false");
  setTimeout(() => el.userId?.focus(), 0);
}

function closeSettings() {
  el.modal.setAttribute("aria-hidden", "true");
}

function updateTextareaHeight() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, window.innerHeight * 0.4)}px`;
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

const imageViewerState = {
  scale: 1,
  baseScale: 1,
  startDist: 0,
};

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
  document.documentElement.style.setProperty("--vh", `${h * 0.01}px`);
}

function getUserMeta() {
  const info = state.platformUser || {};
  const userName = String(info.userName || info.name || info.username || "").trim();
  const org = String(info.org || info.departmentName || info.orgName || "").trim();
  const phone = String(info.phone || info.mobile || "").trim();
  return {
    userName: userName || DEFAULT_USER_META.userName,
    org: org || DEFAULT_USER_META.org,
    phone: phone || DEFAULT_USER_META.phone,
  };
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
    throw new Error(`创建对话失败（${res.status}）：${txt || res.statusText || "Unknown error"}`);
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
    throw new Error(`请求失败（${res.status}）：${txt || res.statusText || "Unknown error"}`);
  }

  const data = await res.json().catch(() => ({}));
  return { answer: String(data?.answer || data?.message || data?.content || "") };
}

async function agentChatStream({ query, signal, onDelta, threadId }) {
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
    throw new Error(`请求失败（${res.status}）：${txt || res.statusText || "Unknown error"}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const data = await res.json().catch(() => ({}));
    onDelta?.(String(data?.answer || ""));
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

      const lines = frame.split("\n").filter(Boolean);
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }

      const dataRaw = dataLines.join("\n").trim();
      if (!dataRaw) continue;
      if (dataRaw === "[DONE]") continue;

      const data = safeJsonParse(dataRaw, null);
      if (!data) continue;
      if (data.event === "message") {
        const chunk = String(data.answer || "");
        if (chunk) onDelta?.(chunk);
      }
    }
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

  const assistantMsg = { role: "assistant", content: "", time: nowTime(), status: "typing" };
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
      onDelta: (chunk) => {
        assistantMsg.content += chunk;
        setBubbleContent(assistantNode.bubble, "assistant", assistantMsg.content);
        if (autoScroll) scrollToBottom(el.messages);
        updateScrollButton();
      },
    });

    assistantMsg.status = "done";
    assistantNode.meta.querySelector(".msg__spinner")?.remove();
    setBubbleContent(assistantNode.bubble, "assistant", assistantMsg.content);
    updateScrollButton();
    conv.updatedAt = Date.now();
    if (conv.title === "新对话") {
      conv.title = deriveTitleFromMessages(conv.messages);
    }
    saveConversations();
    updateConversationList();
  } catch (err) {
    if (err?.name === "AbortError") {
      assistantMsg.status = "done";
      assistantMsg.content = assistantMsg.content || "（已停止）";
      setBubbleContent(assistantNode.bubble, "assistant", assistantMsg.content);
      assistantNode.meta.querySelector(".msg__spinner")?.remove();
      updateScrollButton();
      conv.updatedAt = Date.now();
      saveConversations();
      updateConversationList();
      setTips("已停止。");
    } else {
      assistantMsg.status = "error";
      assistantMsg.content = assistantMsg.content || `出错：${String(err?.message || err)}`;
      setBubbleContent(assistantNode.bubble, "assistant", assistantMsg.content);
      assistantNode.meta.querySelector(".msg__spinner")?.remove();
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
  setTips("正在停止…");
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
}

// Events
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
    const next = imageViewerState.baseScale * (dist / imageViewerState.startDist);
    setImageScale(next);
  },
  { passive: false },
);

el.imageViewerImg.addEventListener("touchend", () => {
  if (imageViewerState.scale < 1) setImageScale(1);
  if (imageViewerState.scale > 3) setImageScale(3);
});

// Init
updateVhVar();
window.visualViewport?.addEventListener("resize", updateVhVar);
window.addEventListener("resize", updateVhVar);

el.input.placeholder = "询问任何问题…";
if (IS_MOBILE) {
  el.input.setAttribute("enterkeyhint", "done");
} else {
  el.input.setAttribute("enterkeyhint", "send");
}

async function bootstrap() {
  await initPlatformUser();
  setConnHint();
  renderAll();
  updateTextareaHeight();
  updateScrollButton();
  updateConversationList();
  await initConversations();

  if (!isConfigured(state.config)) {
    // first visit: guide to settings quickly
    setTimeout(openSettings, 200);
  }
}

bootstrap();

import { getLoginUserInfo } from "./platform-bridge.js";
import { renderMarkdownLite } from "./markdown.js";
import {
  clampMessages,
  deriveTitleFromMessages,
  formatConversationTime,
  getDefaultProxyBaseUrl,
  formatRuntimeError,
  isProxyBaseUrl,
  normalizeBaseUrl,
  nowTime,
  pickPlatformUserId,
  randomId,
  readResponseError,
  safeJsonParse,
  scrollToBottom,
  shouldAutoScroll,
} from "./utils.js";
import {
  captureAuthCodeFromUrl,
  loadAuthState,
  startAuthFlow,
  tryLoginWithStoredToken,
  updateAuthDisplay,
} from "./auth.js";
import {
  fetchFeedbackStatus,
  initFeedbackState,
  openFeedbackModal,
  resetFeedbackHint,
  sendFeedback,
  submitFeedbackModal,
  updateFeedbackReason,
  updateFeedbackState,
  closeFeedbackModal,
} from "./feedback.js";
import { agentChatStream, createAgentThread } from "./chat-api.js";
const STORAGE_KEY = "h5ChatbotConfig:v1";
const LEGACY_CHAT_KEY = "h5ChatbotChat:v1";
const LOCAL_CONVERSATION_KEY = "h5ChatbotConversations:v1";
const AGENT_ID = "ChatbotAgent";
const FEEDBACK_ENDPOINT_PATH = "/feedback";
const EMPTY_ASSISTANT_FALLBACK = "抱歉，本次上游服务没有返回可展示的内容。请稍后重试，或换个问法再试一次。";
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
  feedbackModal: document.getElementById("feedbackModal"),
  feedbackBackdrop: document.getElementById("feedbackBackdrop"),
  feedbackCloseBtn: document.getElementById("feedbackCloseBtn"),
  feedbackCancelBtn: document.getElementById("feedbackCancelBtn"),
  feedbackSubmitBtn: document.getElementById("feedbackSubmitBtn"),
  feedbackInput: document.getElementById("feedbackInput"),
  feedbackHint: document.getElementById("feedbackHint"),
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
/**
 * 从本地存储恢复页面配置，并补齐默认值。
 *
 * @returns {object} 当前页面配置。
 */
function loadConfig() {
  const saved = safeJsonParse(
    localStorage.getItem(STORAGE_KEY) || "null",
    null,
  );
  const defaultBaseUrl = getDefaultProxyBaseUrl();
  const baseUrl = normalizeBaseUrl(saved?.baseUrl || defaultBaseUrl);
  const apiKey = String(saved?.apiKey || "");
  const userId = String(saved?.userId || randomId("user"));
  const responseMode = "streaming";
  const platform = "agent";
  return { baseUrl, apiKey, userId, responseMode, platform };
}
/**
 * 将页面配置持久化到本地存储。
 *
 * @param {object} cfg 页面配置对象。
 */
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

function getLocalConversationKey(userId = state.config.userId) {
  return `${LOCAL_CONVERSATION_KEY}:${String(userId || "anonymous")}`;
}

function saveConversationsToLocal(payload) {
  try {
    localStorage.setItem(getLocalConversationKey(), JSON.stringify(payload));
  } catch {
    // ignore local cache failures
  }
}

function loadConversationsFromLocal() {
  const data = safeJsonParse(
    localStorage.getItem(getLocalConversationKey()) || "null",
    null,
  );
  const items = Array.isArray(data?.items)
    ? data.items.map(normalizeConversation)
    : [];
  const preferredId = String(data?.activeId || "");
  return {
    items,
    activeId: items.some((c) => c.id === preferredId)
      ? preferredId
      : items[0]?.id || "",
  };
}

/**
 * 归一化单个会话对象，保证字段齐全且消息数量受限。
 *
 * @param {object} item 原始会话对象。
 * @returns {object} 规范化后的会话对象。
 */
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
/**
 * 基于种子数据创建一个新的本地会话对象。
 *
 * @param {object} seed 新会话的初始字段。
 * @returns {object} 新建会话对象。
 */
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
/**
 * 计算当前页面应使用的会话存储/代理接口地址。
 *
 * @returns {string} 最终可用的 API Base URL。
 */
function getStoreBase() {
  const b = normalizeBaseUrl(state.config.baseUrl);
  if (b === "/api") {
    return getDefaultProxyBaseUrl();
  }
  if (isProxyBaseUrl(b)) return b;
  return getDefaultProxyBaseUrl();
}
/**
 * 从后端会话存储服务拉取当前用户的会话列表。
 *
 * @returns {Promise<{items: Array, activeId: string}>} 会话列表与当前激活会话 ID。
 */
async function fetchConversationsFromServer() {
  const url = `${getStoreBase()}/conversations?userId=${encodeURIComponent(state.config.userId)}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(await readResponseError(res, "加载会话失败"));
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
/**
 * 将前端会话对象转换成服务端同步所需的精简结构。
 *
 * @param {object} conv 当前会话对象。
 * @returns {object} 可用于同步的会话负载。
 */
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
/**
 * 将服务端返回的消息 ID 回填到本地消息对象中。
 *
 * @param {Record<string, Array>} messageIdMap 会话到消息 ID 的映射。
 */
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
/**
 * 将当前用户的会话列表同步到后端存储服务。
 *
 * @param {object} payload 同步负载。
 * @returns {Promise<object>} 服务端同步结果。
 */
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
    throw new Error(await readResponseError(res, "同步会话失败"));
  }
  const data = await res.json().catch(() => ({}));
  if (data?.messageIds) {
    applyMessageIds(data.messageIds);
  }
  return data;
}
/**
 * 对当前内存中的会话列表排序并异步同步到服务端。
 */
function saveConversations() {
  sortConversations();
  const payload = {
    activeId: state.activeId,
    items: state.conversations.map(serializeConversation),
  };
  saveConversationsToLocal(payload);
  syncConversationsToServer(payload).catch((err) => {
    const detail = String(err?.message || err || "").trim();
    setTips(detail ? `会话同步失败：${detail}` : "会话同步失败，请检查服务是否启动。");
  });
}
const initialConfig = loadConfig();
saveConfig(initialConfig);
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
let composerObserver = null;
let composerHeightRaf = 0;
const feedbackState = initFeedbackState();
const IS_MOBILE = (() => {
  const ua = navigator.userAgent || "";
  const touch = navigator.maxTouchPoints || 0;
  return /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(ua) || touch > 1;
})(); // Try to sync userId from the platform SDK before loading conversations.

/**
 * 尝试从宿主平台读取用户信息，并更新本地 userId。
 *
 * @returns {Promise<boolean>} 是否成功拿到平台用户。
 */
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
/**
 * 初始化会话列表，优先读取服务端，失败时回退到本地临时模式。
 *
 * @returns {Promise<void>}
 */
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
      saveConversationsToLocal({
        activeId: state.activeId,
        items: state.conversations.map(serializeConversation),
      });
      return;
    }
  } catch (err) {
    setTips(`会话存储不可用，已读取本地缓存：${formatRuntimeError(err, "加载会话失败")}`);
  }
  const cached = loadConversationsFromLocal();
  if (cached.items.length) {
    state.conversations = cached.items;
    state.activeId = cached.activeId || cached.items[0].id;
    sortConversations();
    renderAll();
    updateConversationList();
    updateScrollButton();
  }
  const legacy = safeJsonParse(
    localStorage.getItem(LEGACY_CHAT_KEY) || "null",
    null,
  );
  if (legacy) {
    localStorage.removeItem(LEGACY_CHAT_KEY);
  }
}
/**
 * 读取问题库文件，失败时回退到默认问题列表。
 *
 * @returns {Promise<void>}
 */
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
/**
 * 判断当前配置是否满足聊天所需的最小条件。
 *
 * @param {object} cfg 页面配置。
 * @returns {boolean} 是否可用于发送消息。
 */
function isConfigured(cfg) {
  if (!cfg.userId) return false;
  return true;
}
/**
 * 更新页面提示文案。
 *
 * @param {string} text 待展示的提示文本。
 */
function setTips(text) {
  el.tips.textContent = text || "";
}
/**
 * 返回平台展示名称。
 *
 * @param {string} platform 平台标识。
 * @returns {string} 平台名称。
 */
function getPlatformLabel(platform) {
  return "ChatbotAgent";
}
/**
 * 获取当前激活会话所属的平台类型。
 *
 * @returns {string} 平台标识。
 */
function getActivePlatform() {
  const conv = getActiveConversation();
  return conv.platform || "agent";
}
/**
 * 更新连接状态提示。
 */
function setConnHint() {
  if (!isConfigured(state.config)) {
    el.connHint.textContent = "未配置平台";
    return;
  }
  el.connHint.textContent = "已连接：ChatbotAgent";
}
/**
 * 获取当前激活会话；若不存在则自动创建。
 *
 * @returns {object} 当前激活会话对象。
 */
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
/**
 * 按更新时间倒序排列会话列表。
 */
function sortConversations() {
  state.conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
/**
 * 根据当前状态重绘会话列表。
 */
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
/**
 * 打开会话列表弹窗。
 */
function openChatList() {
  closeSettings();
  updateConversationList();
  el.chatListModal.setAttribute("aria-hidden", "false");
}
/**
 * 关闭会话列表弹窗。
 */
function closeChatList() {
  el.chatListModal.setAttribute("aria-hidden", "true");
}
/**
 * 切换当前激活会话并刷新相关 UI。
 *
 * @param {string} id 目标会话 ID。
 */
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
/**
 * 将文本复制到剪贴板，失败时回退到 document.execCommand。
 *
 * @param {string} text 待复制文本。
 * @returns {Promise<boolean>} 是否复制成功。
 */
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
/**
 * 生成空状态页面节点，包含欢迎语和推荐问题。
 *
 * @returns {{wrap: HTMLElement}} 空状态根节点。
 */
function createEmptyStateNode() {
  const wrap = document.createElement("section");
  wrap.className = "empty";
  const card = document.createElement("div");
  card.className = "empty__card";
  const icon = document.createElement("div");
  icon.className = "empty__icon";
  icon.innerHTML = `<img src="./static/AIlogo.png" alt="AI产数产品助手" />`;
  const title = document.createElement("div");
  title.className = "empty__title";
  title.textContent = "你好！我是AI产数产品助手";
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
/**
 * 将推荐问题填入输入框，并记录本次输入来源于推荐项。
 *
 * @param {string} text 推荐问题文本。
 */
function setInputFromSuggestion(text) {
  el.input.value = text;
  updateTextareaHeight();
  el.input.focus();
  state.promptSelection = { pending: true, value: text };
}
/**
 * 从问题池中随机选择若干条问题，并排除当前问题。
 *
 * @param {string[]} list 问题池。
 * @param {number} count 需要抽取的数量。
 * @param {string} exclude 需要排除的问题。
 * @returns {string[]} 随机问题列表。
 */
function pickRandomQuestions(list, count, exclude) {
  const pool = (list || []).filter((item) => item && item !== exclude);
  if (!pool.length) return [];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, count));
}
/**
 * 清理消息区底部的追问推荐模块。
 */
function clearFollowupSuggestions() {
  const existing = el.messages.querySelector(".followup");
  existing?.remove();
}
/**
 * 渲染“猜你想问”追问推荐模块。
 *
 * @param {string[]} items 推荐问题列表。
 */
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
/**
 * 在展示前清理助手回复中的前导空行，并修正常见的残缺加粗标记。
 *
 * @param {string} content 助手原始回复文本。
 * @returns {string} 适合前端渲染的文本。
 */
function normalizeAssistantContentForDisplay(content) {
  return String(content || "")
    .replace(/^(?:\uFEFF)?(?:[ \t]*\r?\n)+/, "");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ACTION_ICONS = {
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M8 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h1"/></svg>',
  like: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8.2 20H5a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3h2.1l3.1-5.5A2.3 2.3 0 0 1 14.5 5v4h3.2a3.3 3.3 0 0 1 3.2 4l-1 4.2a3.6 3.6 0 0 1-3.5 2.8H8.2ZM8 11H5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h3v-7Zm2 7h6.4a1.6 1.6 0 0 0 1.6-1.2l1-4.2A1.3 1.3 0 0 0 17.7 11H13a1 1 0 0 1-1-1V5.5a.3.3 0 0 0-.6-.2L10 7.8V18Z"/></svg>',
  dislike: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M15.8 4H19a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3h-2.1l-3.1 5.5A2.3 2.3 0 0 1 9.5 19v-4H6.3a3.3 3.3 0 0 1-3.2-4l1-4.2A3.6 3.6 0 0 1 7.6 4h8.2ZM16 13h3a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-3v7Zm-2-7H7.6A1.6 1.6 0 0 0 6 7.2l-1 4.2A1.3 1.3 0 0 0 6.3 13H11a1 1 0 0 1 1 1v4.5a.3.3 0 0 0 .6.2l1.4-2.5V6Z"/></svg>',
};

function setActionIcon(button, iconName, label) {
  button.classList.add("msg__action--icon");
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = ACTION_ICONS[iconName] || "";
}
/**
 * 按角色与状态更新消息气泡内容。
 *
 * @param {HTMLElement} bubble 消息气泡节点。
 * @param {"user"|"assistant"} role 消息角色。
 * @param {string} content 消息内容。
 * @param {string} status 消息状态。
 */
function setBubbleContent(bubble, role, content, status) {
  if (role === "assistant") {
    bubble.classList.add("md");
    const isTyping = status === "typing";
    const progressText = bubble.dataset.progress || "正在思考";
    const thinkingHtml = `      <div class="md-typing md-typing--block" aria-live="polite">        <span class="md-typing__text">${escapeHtml(progressText)}</span>        <span class="md-typing__dot">.</span>        <span class="md-typing__dot">.</span>        <span class="md-typing__dot">.</span>      </div>    `;
    if (!content) {
      bubble.innerHTML = isTyping ? thinkingHtml : "";
      return;
    }
    const body = renderMarkdownLite(normalizeAssistantContentForDisplay(content));
    bubble.innerHTML = isTyping
      ? `${body}
${thinkingHtml}`
      : body;
  } else {
    bubble.classList.remove("md");
    bubble.textContent = content || "";
  }
}
/**
 * 为单条消息创建 DOM 结构及其交互逻辑。
 *
 * @param {object} message 消息对象。
 * @returns {{wrap: HTMLElement, bubble: HTMLElement, meta: HTMLElement}} 消息节点引用。
 */
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
  setActionIcon(copyBtn, "copy", "复制");
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
    setActionIcon(likeBtn, "like", "点赞");
    likeBtn.setAttribute("data-feedback", "like");
    likeBtn.addEventListener("click", async () => {
      if (message.feedback) return;
      try {
        await sendFeedback(getFeedbackCtx(), message, "like");
        message.feedback = "like";
        message.feedbackReason = "";
        updateFeedbackState(meta, message.feedback, message.status);
        updateFeedbackReason(contentWrap, message.feedbackReason);
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
    setActionIcon(dislikeBtn, "dislike", "点踩");
    dislikeBtn.setAttribute("data-feedback", "dislike");
    dislikeBtn.addEventListener("click", async () => {
      if (message.feedback) return;
      const reason = await openFeedbackModal(el, feedbackState);
      if (reason === null) return;
      const trimmed = String(reason).trim();
      if (!trimmed) {
        setTips("请填写点踩原因");
        setTimeout(() => setTips(""), 1200);
        return;
      }
      try {
        await sendFeedback(getFeedbackCtx(), message, "dislike", trimmed);
        message.feedback = "dislike";
        message.feedbackReason = trimmed;
        updateFeedbackState(meta, message.feedback, message.status);
        updateFeedbackReason(contentWrap, message.feedbackReason);
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
  const reasonEl = document.createElement("div");
  reasonEl.className = "msg__feedback-reason";
  contentWrap.appendChild(reasonEl);
  updateFeedbackReason(contentWrap, message.feedbackReason);
  if (role === "user") {
    wrap.appendChild(contentWrap);
    wrap.appendChild(avatar);
  } else {
    wrap.appendChild(avatar);
    wrap.appendChild(contentWrap);
  }
  if (role === "assistant" && !message.feedbackLoaded) {
    message.feedbackLoaded = true;
    fetchFeedbackStatus(getFeedbackCtx(), message)
      .then((data) => {
        if (!data || !data.has_feedback || !data.feedback) return;
        message.feedback = String(data.feedback.rating || "").trim();
        message.feedbackReason = String(data.feedback.reason || "").trim();
        updateFeedbackState(meta, message.feedback, message.status);
        updateFeedbackReason(contentWrap, message.feedbackReason);
        saveConversations();
      })
      .catch(() => {});
  }
  return { wrap, bubble, meta };
}
/**
 * 根据当前激活会话重绘消息区。
 */
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
/**
 * 打开设置面板并同步当前配置到表单。
 */
function openSettings() {
  closeChatList();
  if (el.baseUrl) el.baseUrl.value = state.config.baseUrl;
  if (el.apiKey) el.apiKey.value = state.config.apiKey;
  if (el.userId) el.userId.value = state.config.userId;
  if (el.responseMode) el.responseMode.value = state.config.responseMode;
  if (el.platform) el.platform.value = "agent";
  updatePlatformUI();
  updateUserInfoDisplay();
  updateAuthDisplay(getAuthCtx());
  el.modal.setAttribute("aria-hidden", "false");
  setTimeout(() => el.userId?.focus(), 0);
}
/**
 * 关闭设置面板。
 */
function closeSettings() {
  el.modal.setAttribute("aria-hidden", "true");
}
/**
 * 切换开发者设置按钮的显示状态。
 *
 * @param {boolean} visible 是否显示设置按钮。
 */
function toggleDevSettingsButton(visible) {
  document.body.classList.toggle("dev-settings-visible", Boolean(visible));
}

const devToolsBaseline = {
  widthGap: Math.abs(window.outerWidth - window.innerWidth),
  heightGap: Math.abs(window.outerHeight - window.innerHeight),
};
/**
 * 在浏览器开发者工具打开时显示调试设置入口。
 */
function updateDevSettingsVisibility() {
  const threshold = 140;
  const widthGap = Math.abs(window.outerWidth - window.innerWidth);
  const heightGap = Math.abs(window.outerHeight - window.innerHeight);
  const widthDelta = widthGap - devToolsBaseline.widthGap;
  const heightDelta = heightGap - devToolsBaseline.heightGap;
  if (widthDelta > threshold || heightDelta > threshold) {
    toggleDevSettingsButton(true);
  }
}

function isDevToolsShortcut(e) {
  const key = String(e.key || "").toLowerCase();
  return (
    key === "f12" ||
    (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(key))
  );
}
/**
 * 根据输入内容动态调整文本域高度。
 */
function updateTextareaHeight() {
  el.input.style.height = "auto";
  el.input.style.height = `${Math.min(el.input.scrollHeight, window.innerHeight * 0.4)}
px`;
}
/**
 * 刷新设置面板中的平台相关控件状态。
 */
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
      el.baseUrl.value = getDefaultProxyBaseUrl();
    }
  }
}
const imageViewerState = { scale: 1, baseScale: 1, startDist: 0 };
/**
 * 更新图片预览器缩放比例。
 *
 * @param {number} scale 目标缩放值。
 */
function setImageScale(scale) {
  imageViewerState.scale = Math.max(1, Math.min(3, scale));
  el.imageViewerImg.style.transform = `scale(${imageViewerState.scale})`;
}
/**
 * 计算两个触点之间的距离。
 *
 * @param {Touch} t1 第一个触点。
 * @param {Touch} t2 第二个触点。
 * @returns {number} 两点之间的距离。
 */
function getTouchDistance(t1, t2) {
  const dx = t1.clientX - t2.clientX;
  const dy = t1.clientY - t2.clientY;
  return Math.hypot(dx, dy);
}
/**
 * 打开图片预览弹层。
 *
 * @param {string} src 图片地址。
 * @param {string} alt 图片说明文本。
 */
function openImageViewer(src, alt) {
  if (!el.imageViewer || !el.imageViewerImg) return;
  el.imageViewerImg.src = src;
  el.imageViewerImg.alt = alt || "图片预览";
  setImageScale(1);
  el.imageViewer.setAttribute("aria-hidden", "false");
}
/**
 * 关闭图片预览弹层并重置状态。
 */
function closeImageViewer() {
  if (!el.imageViewer || !el.imageViewerImg) return;
  el.imageViewer.setAttribute("aria-hidden", "true");
  el.imageViewerImg.src = "";
  setImageScale(1);
}
/**
 * 根据当前视口高度更新页面 CSS 变量。
 */
function updateVhVar() {
  const h = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty(
    "--vh",
    `${h * 0.01}
px`,
  );
}
/**
 * 组合当前用户元信息，供线程创建和聊天接口使用。
 *
 * @returns {{userName: string, org: string, phone: string}} 用户元数据。
 */
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
/**
 * 刷新设置面板中的用户信息展示。
 */
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
/**
 * 将认证接口返回的用户信息写入本地状态。
 *
 * @param {object} userInfo 认证接口返回的用户信息。
 */
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
/**
 * 组装认证模块所需上下文。
 *
 * @returns {object} 认证上下文。
 */
function getAuthCtx() {
  return {
    state,
    el,
    getStoreBase,
    setTips,
    onUserInfo: applyUserInfoFromResponse,
  };
}
/**
 * 组装反馈模块所需上下文。
 *
 * @returns {object} 反馈上下文。
 */
function getFeedbackCtx() {
  return {
    state,
    serializeConversation,
    syncConversationsToServer,
    getStoreBase,
    feedbackEndpointPath: FEEDBACK_ENDPOINT_PATH,
  };
}
/**
 * 组装聊天 API 模块所需上下文。
 *
 * @returns {object} 聊天上下文。
 */
function getChatApiCtx() {
  return {
    getStoreBase,
    getUserMeta,
    AGENT_ID,
  };
}
/**
 * 在请求进行中切换发送与停止按钮状态。
 *
 * @param {boolean} busy 当前是否处于请求中。
 */
function setBusy(busy) {
  el.sendBtn.disabled = busy;
  el.stopBtn.hidden = !busy;
}
/**
 * 根据滚动位置控制“滚到底部”按钮显示。
 */
function updateScrollButton() {
  const show = !shouldAutoScroll(el.messages);
  el.scrollBtn.hidden = !show;
}
/**
 * 发送当前输入内容，并驱动整条消息生命周期。
 *
 * @returns {Promise<void>}
 */
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
      conv.conversationId = await createAgentThread(getChatApiCtx(), conv.title);
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
    feedbackReason: "",
    feedbackLoaded: false,
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
    await agentChatStream(getChatApiCtx(), {
      query: text,
      signal: controller.signal,
      threadId: conv.conversationId,
      onMeta: (messageId) => {
        if (!assistantMsg.externalMessageId && messageId) {
          assistantMsg.externalMessageId = String(messageId);
          saveConversations();
        }
      },
      onProgress: (progress) => {
        assistantNode.bubble.dataset.progress = String(progress || "");
        setBubbleContent(
          assistantNode.bubble,
          "assistant",
          assistantMsg.content,
          assistantMsg.status,
        );
        if (autoScroll) scrollToBottom(el.messages);
        updateScrollButton();
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
    if (!String(assistantMsg.content || "").trim()) {
      assistantMsg.content = EMPTY_ASSISTANT_FALLBACK;
      setTips("上游未返回可展示内容，已显示兜底提示。");
    }
    assistantMsg.status = "done";
    delete assistantNode.bubble.dataset.progress;
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
      delete assistantNode.bubble.dataset.progress;
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
      delete assistantNode.bubble.dataset.progress;
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
      const detail = formatRuntimeError(err, "聊天请求失败");
      setTips(
        detail ||
          (isProxyBaseUrl(state.config.baseUrl)
            ? "请求失败：请检查代理服务是否已启动。"
            : "请求失败：请检查 Base URL / CORS。"),
      );
    }
  } finally {
    state.inFlight = null;
    setBusy(false);
    setConnHint();
  }
}
/**
 * 主动中断当前正在进行中的流式响应。
 */
function stopGeneration() {
  if (!state.inFlight) return;
  state.inFlight.abort();
  setTips("正在停止...");
}
/**
 * 重置当前会话的 conversationId。
 *
 * @param {object} options 重置选项。
 */
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
/**
 * 清空当前会话消息并保留会话对象。
 */
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
/**
 * 在用户确认后清空当前会话。
 */
function clearChatWithConfirm() {
  if (state.inFlight) stopGeneration();
  const conv = getActiveConversation();
  if (!conv.messages.length) return;
  if (!window.confirm("确定要清空当前对话吗？")) return;
  resetConversation({ silent: true });
  clearChat();
}
/**
 * 新建一个空白会话并切换到该会话。
 */
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
el.authStartBtn?.addEventListener("click", () => startAuthFlow(getAuthCtx()));
el.closeSettingsBtn.addEventListener("click", closeSettings);
el.backdrop.addEventListener("click", closeSettings);
el.feedbackBackdrop?.addEventListener("click", () =>
  closeFeedbackModal(el, feedbackState, null),
);
el.feedbackCloseBtn?.addEventListener("click", () =>
  closeFeedbackModal(el, feedbackState, null),
);
el.feedbackCancelBtn?.addEventListener("click", () =>
  closeFeedbackModal(el, feedbackState, null),
);
el.feedbackSubmitBtn?.addEventListener("click", () =>
  submitFeedbackModal(el, feedbackState),
);
el.feedbackInput?.addEventListener("input", () => {
  resetFeedbackHint(el, "请简要说明原因，便于改进。", false);
});
document.addEventListener("keydown", (e) => {
  if (isDevToolsShortcut(e)) {
    toggleDevSettingsButton(true);
  }
  if (e.key === "Escape") {
    closeSettings();
    closeChatList();
    closeImageViewer();
    closeFeedbackModal(el, feedbackState, null);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    updateScrollButton();
    updateDevSettingsVisibility();
  }
});
window.addEventListener("resize", updateDevSettingsVisibility, { passive: true });
setInterval(updateDevSettingsVisibility, 1000);
el.settingsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const cfg = {
    baseUrl: el.baseUrl?.value || getDefaultProxyBaseUrl(),
    apiKey: el.apiKey?.value || "",
    userId: el.userId?.value || randomId("user"),
    responseMode: el.responseMode?.value || "streaming",
    platform: el.platform?.value || "agent",
  };
  const platform = "agent";
  const baseUrl = normalizeBaseUrl(cfg.baseUrl);
  const finalBaseUrl = !isProxyBaseUrl(baseUrl) ? getDefaultProxyBaseUrl() : baseUrl;
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
window.showDevSettings = () => {
  toggleDevSettingsButton(true);
};
window.hideDevSettings = () => {
  toggleDevSettingsButton(false);
};
/**
 * 页面启动入口，负责初始化用户、认证、会话和界面状态。
 *
 * @returns {Promise<void>}
 */
async function bootstrap() {
  await initPlatformUser();
  const hasAuthCode = captureAuthCodeFromUrl(getAuthCtx());
  await loadQuestionBank();
  setConnHint();
  renderAll();
  updateTextareaHeight();
  updateScrollButton();
  updateConversationList();
  updateUserInfoDisplay();
  updateAuthDisplay(getAuthCtx());
  if (!hasAuthCode) {
    const result = await tryLoginWithStoredToken(getAuthCtx());
    if (result.needsAuth) {
      setTips("认证失效，正在重新认证...");
      startAuthFlow(getAuthCtx());
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

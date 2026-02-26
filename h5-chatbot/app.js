import { getLoginUserInfo } from "./platform-bridge.js";
import { renderMarkdownLite } from "./markdown.js";
import {
  clampMessages,
  deriveTitleFromMessages,
  formatConversationTime,
  isProxyBaseUrl,
  normalizeBaseUrl,
  nowTime,
  pickPlatformUserId,
  randomId,
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
let composerObserver = null;
let composerHeightRaf = 0;
const feedbackState = initFeedbackState();
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
    dislikeBtn.textContent = "点踩";
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
  updateAuthDisplay(getAuthCtx());
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
function getAuthCtx() {
  return {
    state,
    el,
    getStoreBase,
    setTips,
    onUserInfo: applyUserInfoFromResponse,
  };
}
function getFeedbackCtx() {
  return {
    state,
    serializeConversation,
    syncConversationsToServer,
    getStoreBase,
    feedbackEndpointPath: FEEDBACK_ENDPOINT_PATH,
  };
}
function getChatApiCtx() {
  return {
    getStoreBase,
    getUserMeta,
    AGENT_ID,
  };
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

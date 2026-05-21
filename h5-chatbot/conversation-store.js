import { safeJsonParse } from "./utils.js";

export const LEGACY_CHAT_KEY = "h5ChatbotChat:v1";
export const LOCAL_CONVERSATION_KEY = "h5ChatbotConversations:v1";

export function normalizeConversation(item) {
  const now = Date.now();
  const messages = Array.isArray(item?.messages)
    ? item.messages.map((msg) => ({
        role: msg?.role === "assistant" ? "assistant" : "user",
        content: String(msg?.content || ""),
        time: String(msg?.time || ""),
        status: msg?.status || "done",
        feedback: String(msg?.feedback || ""),
        feedbackReason: String(msg?.feedbackReason || ""),
        feedbackLoaded: Boolean(msg?.feedbackLoaded),
        externalMessageId: String(msg?.externalMessageId || ""),
        ...(msg?.id ? { id: msg.id } : {}),
      }))
    : [];
  return {
    id: String(item?.id || `conv-${now}-${Math.random().toString(16).slice(2)}`),
    title: String(item?.title || "新对话"),
    conversationId: String(item?.conversationId || item?.difyConversationId || ""),
    platform: item?.platform === "dify" ? "dify" : "agent",
    messages,
    createdAt: Number(item?.createdAt || now),
    updatedAt: Number(item?.updatedAt || now),
  };
}

export function createConversation(seed = {}) {
  const now = Date.now();
  return normalizeConversation({
    id: `conv-${now}-${Math.random().toString(16).slice(2)}`,
    title: "新对话",
    conversationId: "",
    platform: "agent",
    messages: [],
    createdAt: now,
    updatedAt: now,
    ...seed,
  });
}

export function createLocalConversationStorage(getUserId) {
  function getKey(userId = getUserId()) {
    const id = String(userId || "anonymous").trim() || "anonymous";
    return `${LOCAL_CONVERSATION_KEY}:${id}`;
  }

  function save(payload) {
    try {
      localStorage.setItem(getKey(), JSON.stringify(payload));
    } catch {
      // ignore localStorage failures
    }
  }

  function load() {
    return safeJsonParse(localStorage.getItem(getKey()) || "null", {
      items: [],
      activeId: "",
    });
  }

  function loadLegacy() {
    return safeJsonParse(localStorage.getItem(LEGACY_CHAT_KEY) || "null", null);
  }

  function clearLegacy() {
    localStorage.removeItem(LEGACY_CHAT_KEY);
  }

  return {
    clearLegacy,
    getKey,
    load,
    loadLegacy,
    save,
  };
}

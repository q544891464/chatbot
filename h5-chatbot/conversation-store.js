import { safeJsonParse } from "./utils.js";

export const LEGACY_CHAT_KEY = "h5ChatbotChat:v1";
export const LOCAL_CONVERSATION_KEY = "h5ChatbotConversations:v1";

function normalizeAttachment(attachment) {
  return {
    file_id: String(attachment?.file_id || attachment?.fileId || ""),
    file_name: String(attachment?.file_name || attachment?.fileName || attachment?.name || "附件"),
    file_type: String(attachment?.file_type || attachment?.fileType || ""),
    file_size: Number(attachment?.file_size || attachment?.fileSize || 0),
    status: String(attachment?.status || "parsed"),
    uploaded_at: String(attachment?.uploaded_at || attachment?.uploadedAt || ""),
    truncated: Boolean(attachment?.truncated),
  };
}

export function normalizeConversation(item) {
  const now = Date.now();
  const messages = Array.isArray(item?.messages)
    ? item.messages.map((msg) => {
        const messageAttachments = Array.isArray(msg?.attachments)
          ? msg.attachments.map(normalizeAttachment).filter((attachment) => attachment.file_id)
          : [];
        return {
          role: msg?.role === "assistant" ? "assistant" : "user",
          content: String(msg?.content || ""),
          time: String(msg?.time || ""),
          status: msg?.status || "done",
          feedback: String(msg?.feedback || ""),
          feedbackReason: String(msg?.feedbackReason || ""),
          feedbackLoaded: Boolean(msg?.feedbackLoaded),
          externalMessageId: String(msg?.externalMessageId || ""),
          ...(messageAttachments.length ? { attachments: messageAttachments } : {}),
          ...(msg?.id ? { id: msg.id } : {}),
        };
      })
    : [];
  const attachments = Array.isArray(item?.attachments)
    ? item.attachments
        .map(normalizeAttachment)
        .filter((attachment) => attachment.file_id)
    : [];
  return {
    id: String(item?.id || `conv-${now}-${Math.random().toString(16).slice(2)}`),
    title: String(item?.title || "新对话"),
    conversationId: String(item?.conversationId || item?.difyConversationId || ""),
    platform: item?.platform === "dify" ? "dify" : "agent",
    messages,
    attachments,
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

export function createLocalConversationStorage(getUserId, getVariantId = () => "default") {
  function getKey(userId = getUserId()) {
    const id = String(userId || "anonymous").trim() || "anonymous";
    const variant = String(getVariantId() || "default").trim() || "default";
    return `${LOCAL_CONVERSATION_KEY}:${variant}:${id}`;
  }

  function getLegacyUserKey(userId = getUserId()) {
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
    const raw = localStorage.getItem(getKey()) ||
      (String(getVariantId() || "default") === "default"
        ? localStorage.getItem(getLegacyUserKey())
        : "");
    return safeJsonParse(raw || "null", {
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
    getLegacyUserKey,
    load,
    loadLegacy,
    save,
  };
}

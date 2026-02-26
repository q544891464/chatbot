export function nowTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function clampMessages(list) {
  const MAX = 80;
  return list.length > MAX ? list.slice(list.length - MAX) : list;
}

export function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function normalizeBaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

export function isProxyBaseUrl(baseUrl) {
  const b = normalizeBaseUrl(baseUrl);
  return b === "/api" || b.endsWith("/api");
}

export function randomId(prefix = "u") {
  const rnd = Math.random().toString(16).slice(2);
  return `${prefix}-${Date.now().toString(16)}-${rnd}`;
}

export function pickPlatformUserId(userInfo) {
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

export function deriveTitleFromMessages(messages) {
  const first = (messages || []).find((m) => m?.role === "user" && m?.content);
  const text = String(first?.content || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "新对话";
  return text.length > 18 ? `${text.slice(0, 18)}…` : text;
}

export function shouldAutoScroll(container) {
  const threshold = 120;
  return (
    container.scrollHeight - (container.scrollTop + container.clientHeight) <
    threshold
  );
}

export function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

export function formatConversationTime(ts) {
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

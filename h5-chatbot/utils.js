/**
 * 返回当前时间的时分字符串，用于消息时间展示。
 *
 * @returns {string} 形如 HH:mm 的时间文本。
 */
export function nowTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * 限制会话消息条数，避免单个会话无限增长。
 *
 * @param {Array} list 消息数组。
 * @returns {Array} 截断后的消息数组。
 */
export function clampMessages(list) {
  const MAX = 80;
  return list.length > MAX ? list.slice(list.length - MAX) : list;
}

/**
 * 安全解析 JSON，失败时返回兜底值。
 *
 * @param {string} raw 待解析的原始字符串。
 * @param {*} fallback 解析失败时返回的默认值。
 * @returns {*} 解析结果或兜底值。
 */
export function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * 读取接口响应中的错误信息，并拼接统一格式的提示文本。
 *
 * @param {Response} res Fetch Response 对象。
 * @param {string} fallback 默认错误标题。
 * @returns {Promise<string>} 带状态码的错误描述。
 */
export async function readResponseError(res, fallback = "请求失败") {
  const text = await res.text().catch(() => "");
  const data = safeJsonParse(text, null);
  const detail = String(
    data?.error || data?.message || text || res.statusText || fallback,
  ).trim();
  return `${fallback}（HTTP ${res.status}）：${detail}`;
}

/**
 * 规范化运行时异常，尽量转换成对排障更友好的中文提示。
 *
 * @param {*} err 捕获到的错误对象。
 * @param {string} fallback 默认错误标题。
 * @returns {string} 格式化后的错误信息。
 */
export function formatRuntimeError(err, fallback = "请求失败") {
  const message = String(err?.message || err || "").trim();
  if (!message) return fallback;
  if (/Load failed/i.test(message)) {
    return `${fallback}：请求未成功发出，请检查 API Base URL、网络、反向代理、CORS 或 HTTPS/HTTP 混合内容配置`;
  }
  if (/Failed to fetch|fetch failed|NetworkError/i.test(message)) {
    return `${fallback}：无法连接到服务，请检查代理地址、网络或 CORS 配置`;
  }
  if (/AbortError/i.test(message)) {
    return "请求已取消";
  }
  return message;
}

/**
 * 归一化 Base URL，移除尾部斜杠。
 *
 * @param {string} input 原始地址。
 * @returns {string} 归一化后的地址。
 */
export function normalizeBaseUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

/**
 * 判断地址是否指向本地代理接口。
 *
 * @param {string} baseUrl 待判断的 Base URL。
 * @returns {boolean} 是否为代理地址。
 */
export function isProxyBaseUrl(baseUrl) {
  const b = normalizeBaseUrl(baseUrl);
  return b === "/api" || b.endsWith("/api");
}

/**
 * 根据当前页面来源推断默认代理地址。
 *
 * @returns {string} 适合当前运行环境的默认代理地址。
 */
export function getDefaultProxyBaseUrl() {
  if (typeof window === "undefined" || !window.location) {
    return "/api";
  }
  const { protocol } = window.location;
  if (protocol === "file:") {
    return "http://127.0.0.1:8787/api";
  }
  if (protocol === "http:" || protocol === "https:") {
    return "/api";
  }
  return "http://127.0.0.1:8787/api";
}

/**
 * 生成一个带前缀的随机 ID。
 *
 * @param {string} prefix ID 前缀。
 * @returns {string} 随机 ID。
 */
export function randomId(prefix = "u") {
  const rnd = Math.random().toString(16).slice(2);
  return `${prefix}-${Date.now().toString(16)}-${rnd}`;
}

/**
 * 从平台用户对象中挑选一个稳定可用的用户标识。
 *
 * @param {Record<string, any>} userInfo 平台返回的用户信息。
 * @returns {string} 提取到的用户标识。
 */
export function pickPlatformUserId(userInfo) {
  if (!userInfo || typeof userInfo !== "object") return "";
  const candidates = [
    userInfo.phone,
    userInfo.phone_number,
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

/**
 * 根据首条用户消息推导会话标题。
 *
 * @param {Array} messages 会话消息列表。
 * @returns {string} 推导后的会话标题。
 */
export function deriveTitleFromMessages(messages) {
  const first = (messages || []).find((m) => m?.role === "user" && m?.content);
  const text = String(first?.content || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "新对话";
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

/**
 * 判断消息容器是否接近底部，用于决定是否自动滚动。
 *
 * @param {HTMLElement} container 消息滚动容器。
 * @returns {boolean} 是否应自动滚动到底部。
 */
export function shouldAutoScroll(container) {
  const threshold = 120;
  return (
    container.scrollHeight - (container.scrollTop + container.clientHeight) <
    threshold
  );
}

/**
 * 将消息容器滚动到底部。
 *
 * @param {HTMLElement} container 消息滚动容器。
 */
export function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

/**
 * 格式化会话列表中的时间标签。
 *
 * @param {number} ts 时间戳。
 * @returns {string} 同日显示 HH:mm，否则显示 MM/DD。
 */
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

import { formatRuntimeError, readResponseError } from "./utils.js";

/**
 * 初始化反馈弹窗状态。
 *
 * @returns {{resolve: Function | null}} 反馈弹窗内部状态。
 */
export function initFeedbackState() {
  return { resolve: null };
}

/**
 * 组合反馈接口地址。
 *
 * @param {Function} getStoreBase 返回代理 API Base URL 的函数。
 * @param {string} feedbackEndpointPath 反馈接口路径。
 * @returns {string} 完整反馈接口地址。
 */
export function getFeedbackUrl(getStoreBase, feedbackEndpointPath) {
  const base = getStoreBase();
  return `${base}${feedbackEndpointPath}`;
}

/**
 * 根据本地消息行 ID 回源查询外部消息 ID。
 *
 * @param {Function} getStoreBase 返回代理 API Base URL 的函数。
 * @param {object} message 当前消息对象。
 * @returns {Promise<string>} 查询到的外部消息 ID。
 */
export async function fetchExternalMessageId(getStoreBase, message) {
  const messageId = Number.parseInt(String(message?.id || ""), 10);
  if (!Number.isFinite(messageId) || messageId <= 0) return "";
  const url = `${getStoreBase()}/message-meta?messageId=${encodeURIComponent(messageId)}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) return "";
  const data = await res.json().catch(() => ({}));
  return String(data?.externalMessageId || "").trim();
}

/**
 * 确保消息已经拥有可用于反馈的外部消息 ID。
 *
 * @param {object} message 当前消息对象。
 * @param {Function} syncConversationsToServer 会话同步函数。
 * @param {object} payload 同步会话时使用的负载。
 * @returns {Promise<string>} 外部消息 ID。
 */
export async function ensureFeedbackId(message, syncConversationsToServer, payload, getStoreBase) {
  if (message?.externalMessageId) return message.externalMessageId;
  try {
    await syncConversationsToServer(payload);
  } catch {
    // ignore
  }
  if (message?.externalMessageId) return message.externalMessageId;
  try {
    const externalMessageId = await fetchExternalMessageId(getStoreBase, message);
    if (externalMessageId) {
      message.externalMessageId = externalMessageId;
      return externalMessageId;
    }
  } catch {
    // ignore
  }
  return message?.externalMessageId || "";
}

/**
 * 提交点赞或点踩反馈。
 *
 * @param {object} ctx 反馈上下文。
 * @param {object} message 目标消息对象。
 * @param {"like"|"dislike"} rating 反馈类型。
 * @param {string} reason 点踩原因。
 * @returns {Promise<void>}
 */
export async function sendFeedback(ctx, message, rating, reason) {
  const { syncConversationsToServer, getStoreBase, feedbackEndpointPath } = ctx;
  const payload = {
    activeId: ctx.state.activeId,
    items: ctx.state.conversations.map(ctx.serializeConversation),
  };
  const id = await ensureFeedbackId(
    message,
    syncConversationsToServer,
    payload,
    getStoreBase,
  );
  if (!id) {
    throw new Error("提交反馈失败：未获取到外部消息 ID，请先确认消息已成功落库");
  }
  const request = { messageId: id, rating };
  if (rating === "dislike") {
    request.reason = reason || "";
  }
  const url = getFeedbackUrl(getStoreBase, feedbackEndpointPath);
  if (!url) {
    throw new Error("提交反馈失败：反馈接口地址为空");
  }
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch (err) {
    throw new Error(formatRuntimeError(err, "提交反馈失败"));
  }
  if (!res.ok) {
    throw new Error(await readResponseError(res, "提交反馈失败"));
  }
}

/**
 * 查询当前消息的反馈状态。
 *
 * @param {object} ctx 反馈上下文。
 * @param {object} message 目标消息对象。
 * @returns {Promise<object|null>} 反馈状态对象或 null。
 */
export async function fetchFeedbackStatus(ctx, message) {
  const { syncConversationsToServer, getStoreBase, feedbackEndpointPath } = ctx;
  const payload = {
    activeId: ctx.state.activeId,
    items: ctx.state.conversations.map(ctx.serializeConversation),
  };
  const id = await ensureFeedbackId(
    message,
    syncConversationsToServer,
    payload,
    getStoreBase,
  );
  if (!id) return null;
  const url = `${getFeedbackUrl(getStoreBase, feedbackEndpointPath)}?messageId=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) return null;
  return res.json().catch(() => ({}));
}

/**
 * 刷新消息卡片上的点赞/点踩按钮状态。
 *
 * @param {HTMLElement} meta 消息元信息容器。
 * @param {string} feedback 当前反馈状态。
 * @param {string} status 当前消息状态。
 */
export function updateFeedbackState(meta, feedback, status) {
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

/**
 * 在消息卡片内展示点踩原因。
 *
 * @param {HTMLElement} contentWrap 消息内容容器。
 * @param {string} reason 点踩原因。
 */
export function updateFeedbackReason(contentWrap, reason) {
  if (!contentWrap) return;
  const elReason = contentWrap.querySelector(".msg__feedback-reason");
  if (!elReason) return;
  const text = String(reason || "").trim();
  if (text) {
    elReason.textContent = `原因：${text}`;
    elReason.hidden = false;
  } else {
    elReason.textContent = "";
    elReason.hidden = true;
  }
}

/**
 * 更新反馈弹窗提示文案和错误样式。
 *
 * @param {object} el 反馈相关 DOM 集合。
 * @param {string} text 提示文本。
 * @param {boolean} isError 是否标记为错误提示。
 */
export function resetFeedbackHint(el, text, isError = false) {
  if (!el.feedbackHint) return;
  el.feedbackHint.textContent = text;
  el.feedbackHint.classList.toggle("is-error", isError);
}

/**
 * 打开点踩原因弹窗，并返回用户输入结果的 Promise。
 *
 * @param {object} el 反馈相关 DOM 集合。
 * @param {object} feedbackState 弹窗状态对象。
 * @returns {Promise<string|null>} 用户输入的原因或 null。
 */
export function openFeedbackModal(el, feedbackState) {
  if (!el.feedbackModal || !el.feedbackInput) return Promise.resolve(null);
  if (feedbackState.resolve) return Promise.resolve(null);
  el.feedbackInput.value = "";
  resetFeedbackHint(el, "请简要说明原因，便于改进。", false);
  el.feedbackModal.setAttribute("aria-hidden", "false");
  setTimeout(() => el.feedbackInput.focus(), 0);
  return new Promise((resolve) => {
    feedbackState.resolve = resolve;
  });
}

/**
 * 关闭反馈弹窗，并将结果回传给等待中的 Promise。
 *
 * @param {object} el 反馈相关 DOM 集合。
 * @param {object} feedbackState 弹窗状态对象。
 * @param {string|null} result 用户输入结果。
 */
export function closeFeedbackModal(el, feedbackState, result) {
  if (!el.feedbackModal) return;
  el.feedbackModal.setAttribute("aria-hidden", "true");
  if (feedbackState.resolve) {
    const resolve = feedbackState.resolve;
    feedbackState.resolve = null;
    resolve(result ?? null);
  }
}

/**
 * 校验反馈原因输入并提交弹窗结果。
 *
 * @param {object} el 反馈相关 DOM 集合。
 * @param {object} feedbackState 弹窗状态对象。
 */
export function submitFeedbackModal(el, feedbackState) {
  if (!el.feedbackInput) return;
  const reason = el.feedbackInput.value.trim();
  if (!reason) {
    resetFeedbackHint(el, "请填写点踩原因。", true);
    return;
  }
  closeFeedbackModal(el, feedbackState, reason);
}

export function initFeedbackState() {
  return { resolve: null };
}

export function getFeedbackUrl(getStoreBase, feedbackEndpointPath) {
  const base = getStoreBase();
  return `${base}${feedbackEndpointPath}`;
}

export async function ensureFeedbackId(message, syncConversationsToServer, payload) {
  if (message?.externalMessageId) return message.externalMessageId;
  try {
    await syncConversationsToServer(payload);
  } catch {
    // ignore
  }
  return message?.externalMessageId || "";
}

export async function sendFeedback(ctx, message, rating, reason) {
  const { syncConversationsToServer, getStoreBase, feedbackEndpointPath } = ctx;
  const payload = {
    activeId: ctx.state.activeId,
    items: ctx.state.conversations.map(ctx.serializeConversation),
  };
  const id = await ensureFeedbackId(message, syncConversationsToServer, payload);
  if (!id) {
    throw new Error("未获取到外部消息ID");
  }
  const request = { messageId: id, rating };
  if (rating === "dislike") {
    request.reason = reason || "";
  }
  const url = getFeedbackUrl(getStoreBase, feedbackEndpointPath);
  if (!url) {
    throw new Error("未获取到外部消息ID");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || res.statusText || "反馈失败");
  }
}

export async function fetchFeedbackStatus(ctx, message) {
  const { syncConversationsToServer, getStoreBase, feedbackEndpointPath } = ctx;
  const payload = {
    activeId: ctx.state.activeId,
    items: ctx.state.conversations.map(ctx.serializeConversation),
  };
  const id = await ensureFeedbackId(message, syncConversationsToServer, payload);
  if (!id) return null;
  const url = `${getFeedbackUrl(getStoreBase, feedbackEndpointPath)}?messageId=${encodeURIComponent(id)}`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) return null;
  return res.json().catch(() => ({}));
}

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

export function resetFeedbackHint(el, text, isError = false) {
  if (!el.feedbackHint) return;
  el.feedbackHint.textContent = text;
  el.feedbackHint.classList.toggle("is-error", isError);
}

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

export function closeFeedbackModal(el, feedbackState, result) {
  if (!el.feedbackModal) return;
  el.feedbackModal.setAttribute("aria-hidden", "true");
  if (feedbackState.resolve) {
    const resolve = feedbackState.resolve;
    feedbackState.resolve = null;
    resolve(result ?? null);
  }
}

export function submitFeedbackModal(el, feedbackState) {
  if (!el.feedbackInput) return;
  const reason = el.feedbackInput.value.trim();
  if (!reason) {
    resetFeedbackHint(el, "请填写点踩原因。", true);
    return;
  }
  closeFeedbackModal(el, feedbackState, reason);
}

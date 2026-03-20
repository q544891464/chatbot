import {
  formatRuntimeError,
  readResponseError,
  safeJsonParse,
} from "./utils.js";

/**
 * 调用本地代理创建上游线程，并返回线程 ID。
 *
 * @param {object} ctx 聊天上下文，提供代理地址、用户元信息和 Agent ID。
 * @param {string} title 会话标题。
 * @returns {Promise<string>} 上游返回的线程 ID。
 */
export async function createAgentThread(ctx, title) {
  const { getStoreBase, getUserMeta, AGENT_ID } = ctx;
  const url = `${getStoreBase()}/alt-thread`;
  const payload = {
    title: String(title || "新对话"),
    agent_id: AGENT_ID,
    metadata: getUserMeta(),
  };
  console.log("[Chatbot] create thread payload:", payload);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(formatRuntimeError(err, "创建对话失败"));
  }

  if (!res.ok) {
    throw new Error(await readResponseError(res, "创建对话失败"));
  }

  const data = await res.json().catch(() => ({}));
  const threadId = String(data?.id || "");
  if (!threadId) {
    throw new Error("创建对话失败：上游未返回对话 ID");
  }
  return threadId;
}

/**
 * 以阻塞方式请求聊天接口并返回完整答案。
 *
 * @param {object} ctx 聊天上下文。
 * @param {object} options 请求参数。
 * @param {string} options.query 用户问题。
 * @param {AbortSignal} options.signal 中断信号。
 * @param {string} options.threadId 上游线程 ID。
 * @returns {Promise<{answer: string, externalMessageId: string}>} 完整回答及消息 ID。
 */
export async function agentChat(ctx, { query, signal, threadId }) {
  const { getStoreBase } = ctx;
  const url = `${getStoreBase()}/alt-chat`;
  const config = { thread_id: threadId || null };
  const payload = { query, config };
  console.log("[Chatbot] chat payload:", payload);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    throw new Error(formatRuntimeError(err, "聊天请求失败"));
  }

  if (!res.ok) {
    throw new Error(await readResponseError(res, "聊天请求失败"));
  }

  const data = await res.json().catch(() => ({}));
  return {
    answer: String(data?.answer || data?.message || data?.content || ""),
    externalMessageId: String(data?.externalMessageId || ""),
  };
}

/**
 * 以流式方式请求聊天接口，并将分片消息逐步回传给 UI。
 *
 * @param {object} ctx 聊天上下文。
 * @param {object} options 请求参数。
 * @param {string} options.query 用户问题。
 * @param {AbortSignal} options.signal 中断信号。
 * @param {Function} options.onDelta 收到文本分片时的回调。
 * @param {Function} options.onMeta 收到消息元信息时的回调。
 * @param {string} options.threadId 上游线程 ID。
 * @returns {Promise<void>}
 */
export async function agentChatStream(
  ctx,
  { query, signal, onDelta, onMeta, threadId },
) {
  const { getStoreBase } = ctx;
  const url = `${getStoreBase()}/alt-chat-stream`;
  const config = { thread_id: threadId || null };
  const payload = { query, config };
  console.log("[Chatbot] chat stream payload:", payload);

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    throw new Error(formatRuntimeError(err, "聊天请求失败"));
  }

  if (!res.ok) {
    throw new Error(await readResponseError(res, "聊天请求失败"));
  }

  let sawChunk = false;

  /**
   * 处理已经解析好的 SSE/JSON 负载，并把元信息或文本分发给调用方。
   *
   * @param {Record<string, any>} data 解析后的消息对象。
   */
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

  /**
   * 处理单个 SSE 帧，优先按 JSON 解析，失败时回退为纯文本分片。
   *
   * @param {string} frame 单个帧文本。
   */
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

  /**
   * 处理浏览器未提供 Reader 时的纯文本回退响应。
   *
   * @param {string} text 完整响应文本。
   */
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

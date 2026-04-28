import {
  formatRuntimeError,
  readResponseError,
  safeJsonParse,
} from "./utils.js";
import { createParser } from "./vendor/eventsource-parser.js";

/**
 * 为单次聊天流请求生成可追踪的日志 ID。
 *
 * @returns {string} 请求日志 ID。
 */
function createStreamRequestId() {
  return `sse-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * 截断日志中的长文本，避免控制台输出过大。
 *
 * @param {string} text 原始文本。
 * @param {number} maxLen 最大保留长度。
 * @returns {string} 截断后的文本。
 */
function previewText(text, maxLen = 160) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}...`;
}

/**
 * 统一输出 SSE 调试日志，便于按 requestId 串联一次流请求。
 *
 * @param {string} requestId 请求日志 ID。
 * @param {string} stage 当前阶段。
 * @param {object} detail 结构化详情。
 */
function logSse(requestId, stage, detail = {}) {
  console.log(`[Chatbot][SSE][${requestId}] ${stage}`, detail);
}

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
 * 分发解析后的 SSE 事件，兼容 JSON 负载与纯文本分片。
 *
 * @param {string} dataRaw SSE data 文本。
 * @param {string} eventName SSE event 名称。
 * @param {Function} onDelta 文本增量回调。
 * @param {Function} onMeta 元信息回调。
 * @param {{sawChunk: boolean}} state 流式读取状态。
 */
function dispatchStreamEvent(dataRaw, eventName, onDelta, onMeta, onProgress, state) {
  const payloadText = String(dataRaw || "").trim();
  if (!payloadText || payloadText === "[DONE]") {
    logSse(state.requestId, "event:skip", {
      reason: payloadText === "[DONE]" ? "done" : "empty",
      eventName: eventName || "",
    });
    return;
  }

  const data = safeJsonParse(payloadText, null);
  if (data && typeof data === "object") {
    const event = String(data.event || eventName || "");
    logSse(state.requestId, "event:json", {
      event: event || "message",
      keys: Object.keys(data),
      preview: previewText(payloadText),
    });
    if (event === "meta") {
      const messageId = data.messageId ?? data.externalMessageId;
      if (messageId !== undefined && messageId !== null) {
        onMeta?.(String(messageId));
      }
      logSse(state.requestId, "event:meta", {
        messageId: messageId !== undefined && messageId !== null ? String(messageId) : "",
      });
      return;
    }
    if (event === "progress") {
      const progress = String(data.message || data.status || "").trim();
      if (progress) {
        onProgress?.(progress);
        logSse(state.requestId, "event:progress", { progress });
      }
      return;
    }

    const messageId = data.messageId ?? data.externalMessageId;
    if (messageId !== undefined && messageId !== null) {
      onMeta?.(String(messageId));
      logSse(state.requestId, "event:message-id", {
        messageId: String(messageId),
        event: event || "message",
      });
    }

    const chunk = String(data.answer || data.content || data.message || "");
    if (!chunk) {
      logSse(state.requestId, "event:no-chunk", {
        event: event || "message",
      });
      return;
    }
    if (event && event !== "message") {
      logSse(state.requestId, "event:ignored", {
        event,
        preview: previewText(payloadText),
      });
      return;
    }

    state.sawChunk = true;
    state.chunkCount += 1;
    state.totalChars += chunk.length;
    logSse(state.requestId, "event:chunk", {
      event: event || "message",
      chunkIndex: state.chunkCount,
      chunkChars: chunk.length,
      totalChars: state.totalChars,
      preview: previewText(chunk),
    });
    onDelta?.(chunk);
    return;
  }

  state.sawChunk = true;
  state.chunkCount += 1;
  state.totalChars += payloadText.length;
  logSse(state.requestId, "event:text", {
    chunkIndex: state.chunkCount,
    chunkChars: payloadText.length,
    totalChars: state.totalChars,
    preview: previewText(payloadText),
  });
  onDelta?.(payloadText);
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
  { query, signal, onDelta, onMeta, onProgress, threadId },
) {
  const { getStoreBase } = ctx;
  const url = `${getStoreBase()}/alt-chat-stream`;
  const config = { thread_id: threadId || null };
  const payload = { query, config };
  console.log("[Chatbot] chat stream payload:", payload);
  const requestId = createStreamRequestId();
  logSse(requestId, "request:start", {
    url,
    threadId: threadId || "",
    queryChars: String(query || "").length,
    queryPreview: previewText(query, 80),
  });

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    logSse(requestId, "request:error", {
      stage: "fetch",
      message: String(err?.message || err || ""),
    });
    throw new Error(formatRuntimeError(err, "聊天请求失败"));
  }

  if (!res.ok) {
    logSse(requestId, "request:http-error", {
      status: res.status,
      statusText: res.statusText,
    });
    throw new Error(await readResponseError(res, "聊天请求失败"));
  }

  logSse(requestId, "request:response", {
    status: res.status,
    contentType: res.headers.get("content-type") || "",
    hasBody: Boolean(res.body),
  });

  const state = {
    requestId,
    sawChunk: false,
    chunkCount: 0,
    totalChars: 0,
  };
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text().catch(() => "");
    logSse(requestId, "reader:fallback", {
      textChars: text.length,
      preview: previewText(text),
    });
    dispatchStreamEvent(text, "", onDelta, onMeta, onProgress, state);
    logSse(requestId, "request:end", {
      mode: "text",
      sawChunk: state.sawChunk,
      chunkCount: state.chunkCount,
      totalChars: state.totalChars,
    });
    return;
  }

  const decoder = new TextDecoder("utf-8");
  const parser = createParser({
    onEvent(event) {
      dispatchStreamEvent(
        event.data,
        String(event.event || ""),
        onDelta,
        onMeta,
        onProgress,
        state,
      );
    },
    onError(err) {
      logSse(requestId, "parser:error", {
        type: String(err?.type || ""),
        field: String(err?.field || ""),
        value: previewText(err?.value || ""),
        line: previewText(err?.line || ""),
        message: String(err?.message || ""),
      });
      // Ignore malformed SSE frames and continue reading the stream.
    },
    onRetry(retry) {
      logSse(requestId, "parser:retry", { retry });
    },
    onComment(comment) {
      logSse(requestId, "parser:comment", {
        preview: previewText(comment),
      });
    }
  });

  let readCount = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    readCount += 1;
    const chunkText = decoder.decode(value, { stream: true });
    logSse(requestId, "reader:chunk", {
      readIndex: readCount,
      byteLength: value?.byteLength || 0,
      textChars: chunkText.length,
      preview: previewText(chunkText),
    });
    parser.feed(chunkText);
  }

  const tail = decoder.decode();
  if (tail) {
    logSse(requestId, "reader:tail", {
      textChars: tail.length,
      preview: previewText(tail),
    });
    parser.feed(tail);
  }
  logSse(requestId, "request:end", {
    mode: "stream",
    readCount,
    sawChunk: state.sawChunk,
    chunkCount: state.chunkCount,
    totalChars: state.totalChars,
  });
}

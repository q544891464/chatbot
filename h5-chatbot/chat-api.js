import { safeJsonParse } from "./utils.js";

export async function createAgentThread(ctx, title) {
  const { getStoreBase, getUserMeta, AGENT_ID } = ctx;
  const url = `${getStoreBase()}/alt-thread`;
  const payload = {
    title: String(title || "新对话"),
    agent_id: AGENT_ID,
    metadata: getUserMeta(),
  };
  console.log("[Chatbot] create thread payload:", payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `创建对话失败（${res.status}）：${txt || res.statusText || "Unknown error"}`,
    );
  }
  const data = await res.json().catch(() => ({}));
  const threadId = String(data?.id || "");
  if (!threadId) {
    throw new Error("创建对话失败：未返回对话 ID");
  }
  return threadId;
}

export async function agentChat(ctx, { query, signal, threadId }) {
  const { getStoreBase } = ctx;
  const url = `${getStoreBase()}/alt-chat`;
  const config = { thread_id: threadId || null };
  const payload = { query, config };
  console.log("[Chatbot] chat payload:", payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `请求失败（${res.status}）：${txt || res.statusText || "Unknown error"}`,
    );
  }
  const data = await res.json().catch(() => ({}));
  return {
    answer: String(data?.answer || data?.message || data?.content || ""),
    externalMessageId: String(data?.externalMessageId || ""),
  };
}

export async function agentChatStream(
  ctx,
  { query, signal, onDelta, onMeta, threadId },
) {
  const { getStoreBase } = ctx;
  const url = `${getStoreBase()}/alt-chat-stream`;
  const config = { thread_id: threadId || null };
  const payload = { query, config };
  console.log("[Chatbot] chat stream payload:", payload);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `请求失败（${res.status}）：${txt || res.statusText || "Unknown error"}`,
    );
  }
  let sawChunk = false;
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

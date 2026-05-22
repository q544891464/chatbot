function createAiWikiService(config) {
  function getApiBaseUrl() {
    const marker = "/api/chat/agent/";
    const idx = config.apiUrl.indexOf(marker);
    if (idx < 0) return "";
    return config.apiUrl.slice(0, idx).replace(/\/+$/, "");
  }

  function getThreadUrl() {
    if (config.threadUrl) return config.threadUrl;
    const base = getApiBaseUrl();
    return base ? `${base}/api/chat/thread` : "";
  }

  function getHistoryUrl(agentId, threadId) {
    const trimmedThreadId = String(threadId || "").trim();
    if (!trimmedThreadId) return "";
    const base = getApiBaseUrl();
    if (!base) return "";
    return `${base}/api/chat/agent/${encodeURIComponent(
      String(agentId || config.agentId).trim() || config.agentId,
    )}/history?thread_id=${encodeURIComponent(trimmedThreadId)}`;
  }

  function getFeedbackUrl(messageId) {
    const base = String(config.feedbackBaseUrl || getApiBaseUrl()).replace(/\/+$/, "");
    if (!base) return "";
    const trimmed = String(messageId || "").trim();
    if (!trimmed) return "";
    return `${base}/api/chat/message/${encodeURIComponent(
      trimmed,
    )}/feedback`;
  }

  return {
    getFeedbackUrl,
    getHistoryUrl,
    getThreadUrl,
  };
}

function isIntegerMessageId(messageId) {
  return /^\d+$/.test(String(messageId || "").trim());
}

module.exports = {
  createAiWikiService,
  isIntegerMessageId,
};

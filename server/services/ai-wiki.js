function createAiWikiService(config) {
  function getThreadUrl() {
    if (config.threadUrl) return config.threadUrl;
    const marker = "/api/chat/agent/";
    const idx = config.apiUrl.indexOf(marker);
    if (idx >= 0) {
      const base = config.apiUrl.slice(0, idx);
      return `${base}/api/chat/thread`;
    }
    return "";
  }

  function getHistoryUrl(agentId, threadId) {
    const trimmedThreadId = String(threadId || "").trim();
    if (!trimmedThreadId) return "";
    const marker = "/api/chat/agent/";
    const idx = config.apiUrl.indexOf(marker);
    if (idx < 0) return "";
    const base = config.apiUrl.slice(0, idx);
    return `${base}/api/chat/agent/${encodeURIComponent(
      String(agentId || config.agentId).trim() || config.agentId,
    )}/history?thread_id=${encodeURIComponent(trimmedThreadId)}`;
  }

  function getFeedbackUrl(messageId) {
    if (!config.feedbackBaseUrl) return "";
    const trimmed = String(messageId || "").trim();
    if (!trimmed) return "";
    return `${config.feedbackBaseUrl}/api/chat/message/${encodeURIComponent(
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

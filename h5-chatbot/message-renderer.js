import { renderMarkdownLite } from "./markdown.js";

export function normalizeAssistantContentForDisplay(content) {
  return String(content || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
}

export function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const ACTION_ICONS = {
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 7a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-1v1a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h1V7Zm2 1h3a3 3 0 0 1 3 3v3h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v1Zm-3 2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H7Z"/></svg>',
  like: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8.4 20H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3.1l2.5-5.2A2.3 2.3 0 0 1 15 5v4h3.2a2.7 2.7 0 0 1 2.63 3.29l-1.18 5A3.5 3.5 0 0 1 16.24 20H8.4ZM8 11H5v7h3v-7Zm2 7h6.24a1.5 1.5 0 0 0 1.46-1.16l1.18-5A.7.7 0 0 0 18.2 11H14a1 1 0 0 1-1-1V5.2a.3.3 0 0 0-.57-.13L10 10.12V18Z"/></svg>',
  dislike: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path fill="currentColor" d="M15.6 4H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3.1l-2.5 5.2A2.3 2.3 0 0 1 9 19v-4H5.8a2.7 2.7 0 0 1-2.63-3.29l1.18-5A3.5 3.5 0 0 1 7.76 4h7.84ZM16 13h3V6h-3v7Zm-2-7H7.76A1.5 1.5 0 0 0 6.3 7.16l-1.18 5A.7.7 0 0 0 5.8 13H10a1 1 0 0 1 1 1v4.8a.3.3 0 0 0 .57.13L14 13.88V6Z"/></svg>',
};

export function setActionIcon(button, iconName, label) {
  button.classList.add("msg__action--icon");
  button.innerHTML = ACTION_ICONS[iconName] || "";
  button.title = label;
  button.setAttribute("aria-label", label);
}

export function setBubbleContent(bubble, role, content, status) {
  if (role === "assistant") {
    bubble.classList.add("md");
    const isTyping = status === "typing";
    const progressText = bubble.dataset.progress || "正在思考";
    const thinkingHtml = `      <div class="md-typing md-typing--block" aria-live="polite">        <span class="md-typing__text">${escapeHtml(progressText)}</span>        <span class="md-typing__dot">.</span>        <span class="md-typing__dot">.</span>        <span class="md-typing__dot">.</span>      </div>    `;
    if (!content) {
      bubble.innerHTML = isTyping ? thinkingHtml : "";
      return;
    }
    const body = renderMarkdownLite(normalizeAssistantContentForDisplay(content));
    bubble.innerHTML = isTyping
      ? `${body}
${thinkingHtml}`
      : body;
    return;
  }
  bubble.classList.remove("md");
  bubble.textContent = content || "";
}

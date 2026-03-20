let markdownRenderer = null;

/**
 * 获取页面中注入的 markdown-it 实例工厂。
 *
 * @returns {Function} markdown-it 构造函数。
 */
function getMarkdownItFactory() {
  const factory = globalThis.markdownit;
  if (typeof factory !== "function") {
    throw new Error("markdown-it 未加载");
  }
  return factory;
}

/**
 * 为链接补充安全属性，统一在新窗口中打开。
 *
 * @param {object} tokens markdown-it token 列表。
 * @param {number} idx 当前 token 下标。
 * @param {object} options markdown-it 渲染选项。
 * @param {object} env 渲染环境。
 * @param {object} self 渲染器实例。
 * @returns {string} 链接起始标签 HTML。
 */
function renderLinkOpen(tokens, idx, options, env, self) {
  const token = tokens[idx];
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, idx, options);
}

/**
 * 为图片节点补充懒加载属性。
 *
 * @param {object} tokens markdown-it token 列表。
 * @param {number} idx 当前 token 下标。
 * @param {object} options markdown-it 渲染选项。
 * @param {object} env 渲染环境。
 * @param {object} self 渲染器实例。
 * @returns {string} 图片 HTML。
 */
function renderImage(tokens, idx, options, env, self) {
  const token = tokens[idx];
  token.attrSet("loading", "lazy");
  token.attrSet("decoding", "async");
  return self.renderToken(tokens, idx, options);
}

/**
 * 渲染围栏代码块，兼容现有样式类名。
 *
 * @param {object} tokens markdown-it token 列表。
 * @param {number} idx 当前 token 下标。
 * @returns {string} 代码块 HTML。
 */
function renderFence(tokens, idx) {
  const token = tokens[idx];
  const info = String(token.info || "").trim();
  const langName = info ? info.split(/\s+/)[0] : "";
  const escaped = token.content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const classAttr = langName ? ` class="language-${langName}"` : "";
  return `<pre class="md-code"><code${classAttr}>${escaped}</code></pre>`;
}

/**
 * 渲染缩进代码块，兼容现有样式类名。
 *
 * @param {object} tokens markdown-it token 列表。
 * @param {number} idx 当前 token 下标。
 * @returns {string} 代码块 HTML。
 */
function renderCodeBlock(tokens, idx) {
  const escaped = String(tokens[idx].content || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre class="md-code"><code>${escaped}</code></pre>`;
}

/**
 * 渲染行内代码，兼容现有样式类名。
 *
 * @param {object} tokens markdown-it token 列表。
 * @param {number} idx 当前 token 下标。
 * @returns {string} 行内代码 HTML。
 */
function renderCodeInline(tokens, idx) {
  const escaped = String(tokens[idx].content || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<code class="md-inline">${escaped}</code>`;
}

/**
 * 初始化 markdown-it，并按现有页面样式做轻量适配。
 *
 * @returns {object} markdown-it 实例。
 */
function getRenderer() {
  if (markdownRenderer) return markdownRenderer;
  const MarkdownIt = getMarkdownItFactory();
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false,
  });

  md.renderer.rules.link_open = renderLinkOpen;
  md.renderer.rules.image = renderImage;
  md.renderer.rules.fence = renderFence;
  md.renderer.rules.code_block = renderCodeBlock;
  md.renderer.rules.code_inline = renderCodeInline;
  md.renderer.rules.table_open = () => '<div class="md-table"><table>';
  md.renderer.rules.table_close = () => "</table></div>";

  markdownRenderer = md;
  return markdownRenderer;
}

/**
 * 将助手原始文本规范化后交给 markdown-it 渲染。
 *
 * @param {string} text 助手原始文本。
 * @returns {string} 最终 HTML。
 */
function renderMarkdownLite(text) {
  const src = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/^(?:\uFEFF)?(?:[ \t]*\n)+/, "");
  return getRenderer().render(src);
}

export { renderMarkdownLite };

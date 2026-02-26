function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isImageUrl(url) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(url || "");
}

function renderInlineMarkdown(escapedText) {
  let out = String(escapedText || "");
  const placeholders = [];
  const token = (i) => `@@MD${i}@@`;
  out = out.replace(/(^|\n)\s*([^\n*]{1,12})\*\*(?=\s*[:：])/g, "$1**$2**");
  const pushPlaceholder = (html) => {
    const i = placeholders.length;
    placeholders.push(html);
    return token(i);
  };
  const normalizeUrlToken = (raw) => {
    let url = String(raw || "");
    if (!url) return url;
    url = url.replace(/^(&quot;|&#39;|&apos;|["'`<])+/gi, "");
    url = url.replace(/([>"'`]|&quot;|&#39;|&apos;)+$/gi, "");
    return url;
  };
  const renderUrlToken = (raw, altText) => {
    const url = normalizeUrlToken(raw);
    if (!url) return raw;
    if (isImageUrl(url)) {
      return pushPlaceholder(
        `<img src="${url}" alt="${altText || "image"}" loading="lazy" decoding="async" />`,
      );
    }
    return pushPlaceholder(
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
    );
  };
  out = out.replace(
    /!\[([^\]]*)\]\s*\(\s*(https?:\/\/[^\s)]+)\s*\)/g,
    (_, alt, url) => {
      return renderUrlToken(url, alt);
    },
  );
  out = out.replace(/`([^`\n]+)`/g, (_, code) => {
    return pushPlaceholder(`<code class="md-inline">${code}</code>`);
  });
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => {
      const cleanUrl = normalizeUrlToken(url);
      if (!cleanUrl) return label;
      return pushPlaceholder(
        `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`,
      );
    },
  );
  out = out.replace(/(https?:\/\/[^\s<]+[^\s<\.)])/g, (url) => {
    return renderUrlToken(url);
  });
  out = out.replace(/~~([^\n~]+)~~/g, "<del>$1</del>");
  out = out.replace(/(\*\*|__)([^\n]+?)\1/g, "<strong>$2</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  for (let i = 0; i < placeholders.length; i++) {
    out = out.replaceAll(token(i), placeholders[i]);
  }
  return out;
}

function normalizeMarkdownText(text) {
  let out = String(text || "");
  const urls = [];
  out = out.replace(/https?:\/\/[^\s<]+/g, (match) => {
    const idx = urls.length;
    urls.push(match);
    return `@@URL${idx}@@`;
  });
  out = out.replace(/([^\n])\s*(#{1,6})\s*(?=\S)/g, "$1\n$2 ");
  out = out.replace(/([:：。！？?.])\\s*([-*])\\s+(?=\\S)/g, "$1\\n$2 ");
  out = out.replace(/([:：。！？?.])\\s*(\\d+\\.)\\s+(?=\\S)/g, "$1\\n$2 ");
  out = out.replace(
    /([\u4e00-\u9fff。！？；：，、）\)\]】])\s*-\s*(?=\S)/g,
    "$1\n- ",
  );
  out = out.replace(
    /([\u4e00-\u9fff。！？；：，、）\)\]】])\s*(\d+\.)\s*(?=(\*\*|[\u4e00-\u9fffA-Za-z]))/g,
    "$1\n$2 ",
  );
  out = out.replace(/(\n\s*[-*])(?=\S)/g, "$1 ");
  out = out.replace(/(\n\s*\d+\.)(?=\S)/g, "$1 ");
  for (let i = 0; i < urls.length; i++) {
    out = out.replaceAll(`@@URL${i}@@`, urls[i]);
  }
  return out;
}

function renderMarkdownLite(text) {
  const src = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const unescaped = src
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
  const normalizedSrc = unescaped.replace(
    /(^|\n)([^*\n]+?)\s*\*\*(?=\n|$)/g,
    "$1**$2**",
  );
  const tokens = [];
  const fenceRe = /```([\w-]+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let m;
  while ((m = fenceRe.exec(normalizedSrc))) {
    const before = normalizedSrc.slice(lastIndex, m.index);
    if (before) tokens.push({ type: "text", value: before });
    tokens.push({ type: "code", lang: m[1] || "", value: m[2] || "" });
    lastIndex = m.index + m[0].length;
  }
  const tail = normalizedSrc.slice(lastIndex);
  if (tail) tokens.push({ type: "text", value: tail });
  let html = "";
  const isListBlock = (block, ordered) => {
    const lines = String(block || "").split("\n");
    let hasItem = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      const isItem = ordered
        ? /^\s*\d+\.\s+/.test(line)
        : /^\s*[-*]\s+/.test(line);
      if (isItem) {
        hasItem = true;
        continue;
      }
      if (/^\s{2,}\S/.test(line)) continue;
      return false;
    }
    return hasItem;
  };
  const isContinuationBlock = (block) => {
    const lines = String(block || "").split("\n");
    let hasIndented = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      if (/^\s{2,}\S/.test(line)) {
        hasIndented = true;
        continue;
      }
      return false;
    }
    return hasIndented;
  };
  const isSeparatorToken = (value) =>
    /^:?-{3,}:?$/.test(String(value || "").trim());
  const isTableSeparatorLine = (line) => {
    let row = String(line || "").trim();
    if (!row) return false;
    if (row.startsWith("|")) row = row.slice(1);
    if (row.endsWith("|")) row = row.slice(0, -1);
    const cells = row.split("|").map((cell) => cell.trim());
    if (!cells.length) return false;
    return cells.every((cell) => isSeparatorToken(cell));
  };
  const parseTableRow = (line) => {
    let row = String(line || "").trim();
    if (row.startsWith("|")) row = row.slice(1);
    if (row.endsWith("|")) row = row.slice(0, -1);
    return row.split("|").map((cell) => cell.trim());
  };
  const isTableBlock = (block) => {
    const lines = String(block || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return false;
    if (!lines[0].includes("|")) return false;
    return isTableSeparatorLine(lines[1]);
  };
  const splitTablesFromBlock = (block) => {
    const lines = String(block || "").split("\n");
    const segments = [];
    let buffer = [];
    const flushBuffer = () => {
      if (buffer.length) {
        segments.push(buffer.join("\n"));
        buffer = [];
      }
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed && line.includes("|")) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j += 1;
        if (j < lines.length && isTableSeparatorLine(lines[j])) {
          flushBuffer();
          const tableLines = [lines[i], lines[j]];
          i = j + 1;
          while (i < lines.length) {
            const rowLine = lines[i];
            const rowTrim = rowLine.trim();
            if (!rowTrim) {
              i += 1;
              break;
            }
            if (!rowLine.includes("|")) break;
            tableLines.push(rowLine);
            i += 1;
          }
          segments.push(tableLines.join("\n"));
          continue;
        }
      }
      buffer.push(line);
      i += 1;
    }
    flushBuffer();
    return segments;
  };
  const buildMarkdownTable = (header, rows) => {
    const headerLine = `| ${header.join(" | ")} |`;
    const sepLine = `| ${header.map(() => "---").join(" | ")} |`;
    const rowLines = rows.map((row) => `| ${row.join(" | ")} |`);
    return [headerLine, sepLine, ...rowLines].join("\n");
  };
  const parseInlineTableLine = (line) => {
    if (!line.includes("|")) return null;
    const cleaned = line
      .replace(/```[a-z0-9-]*/gi, "")
      .replace(/```/g, "")
      .trim();
    if (!cleaned.includes("|")) return null;
    let tokens = cleaned.split("|").map((item) => item.trim());
    if (tokens[0] === "") tokens = tokens.slice(1);
    if (tokens[tokens.length - 1] === "") tokens = tokens.slice(0, -1);
    if (tokens.length < 4) return null;
    const lowerFirst = String(tokens[0] || "").toLowerCase();
    if (lowerFirst === "markdown" || lowerFirst === "md") {
      tokens = tokens.slice(1);
    }
    if (tokens.length < 4) return null;
    const parseTokens = (parts, prefixCandidate) => {
      let sepStart = -1;
      for (let i = 0; i < parts.length; i++) {
        if (isSeparatorToken(parts[i])) {
          sepStart = i;
          break;
        }
      }
      if (sepStart <= 0) return null;
      let sepEnd = sepStart;
      while (sepEnd < parts.length && isSeparatorToken(parts[sepEnd])) {
        sepEnd += 1;
      }
      const header = parts.slice(0, sepStart);
      const columnCount = sepEnd - sepStart;
      if (!columnCount || header.length !== columnCount) return null;
      let prefix = prefixCandidate ? String(prefixCandidate).trim() : "";
      const firstHeader = header[0] || "";
      const colonIndex = Math.max(
        firstHeader.lastIndexOf("："),
        firstHeader.lastIndexOf(":"),
      );
      if (colonIndex > -1 && colonIndex < firstHeader.length - 1) {
        const headPrefix = firstHeader.slice(0, colonIndex + 1).trim();
        header[0] = firstHeader.slice(colonIndex + 1).trim();
        prefix = [prefix, headPrefix].filter(Boolean).join(" ");
      }
      let rest = parts.slice(sepEnd);
      if (rest.length < columnCount) return null;
      const rows = [];
      while (rest.length >= columnCount) {
        rows.push(rest.slice(0, columnCount));
        rest = rest.slice(columnCount);
      }
      const suffix = rest.join(" ").trim();
      return { prefix, table: buildMarkdownTable(header, rows), suffix };
    };
    const direct = parseTokens(tokens, "");
    if (direct) return direct;
    const prefixCandidate = tokens[0];
    const colonHint =
      prefixCandidate?.includes("：") ||
      prefixCandidate?.includes(":") ||
      /表格|资费|如下|如下表|如下图/.test(prefixCandidate || "");
    if (!colonHint) return null;
    return parseTokens(tokens.slice(1), prefixCandidate);
  };
  const expandInlineTables = (text) => {
    const lines = String(text || "").split("\n");
    const outLines = [];
    for (const line of lines) {
      const parsed = parseInlineTableLine(line);
      if (!parsed) {
        outLines.push(line);
        continue;
      }
      if (parsed.prefix) outLines.push(parsed.prefix);
      outLines.push(parsed.table);
      if (parsed.suffix) outLines.push(parsed.suffix);
    }
    return outLines.join("\n");
  };
  for (const t of tokens) {
    if (t.type === "code") {
      const codeEscaped = escapeHtml(t.value);
      html += `<pre class="md-code"><code>${codeEscaped}</code></pre>`;
      continue;
    }
    const normalized = expandInlineTables(normalizeMarkdownText(t.value));
    const rawBlocks = String(normalized).split(/\n{2,}/);
    const blocks = [];
    for (const block of rawBlocks) {
      if (!block.trim()) continue;
      const lastIdx = blocks.length - 1;
      if (lastIdx >= 0) {
        const last = blocks[lastIdx];
        if (isListBlock(last, true) && isListBlock(block, true)) {
          blocks[lastIdx] = `${last}\n${block}`;
          continue;
        }
        if (isListBlock(last, false) && isListBlock(block, false)) {
          blocks[lastIdx] = `${last}\n${block}`;
          continue;
        }
        if (isListBlock(last, true) && isContinuationBlock(block)) {
          blocks[lastIdx] = `${last}\n${block}`;
          continue;
        }
        if (isListBlock(last, false) && isContinuationBlock(block)) {
          blocks[lastIdx] = `${last}\n${block}`;
          continue;
        }
      }
      blocks.push(block);
    }
    const expandedBlocks = [];
    for (const block of blocks) {
      const segments = splitTablesFromBlock(block);
      for (const seg of segments) {
        if (seg.trim()) expandedBlocks.push(seg);
      }
    }
    for (const block of expandedBlocks) {
      const trimmed = block.trimEnd();
      if (!trimmed.trim()) continue;
      const lines = trimmed.split("\n");
      const hasHeading = lines.some((l) => /^ {0,3}(#{1,6})\s+/.test(l.trim()));
      const hasRule = lines.some((l) =>
        /^ {0,3}(-{3,}|\*{3,}|_{3,})$/.test(l.trim()),
      );
      const hasQuote = lines.some((l) => /^\s*>/.test(l));
      const isUl = isListBlock(trimmed, false);
      const isOl = isListBlock(trimmed, true);
      if (isTableBlock(trimmed)) {
        const tableLines = trimmed
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const header = parseTableRow(tableLines[0]);
        const rows = tableLines
          .slice(2)
          .map(parseTableRow)
          .filter((row) => row.length);
        const maxCols = Math.max(
          header.length,
          rows.reduce((max, row) => Math.max(max, row.length), 0),
        );
        const padRow = (row) => {
          const next = row.slice(0, maxCols);
          while (next.length < maxCols) next.push("");
          return next;
        };
        const renderRow = (cells, cellTag) => {
          const htmlCells = cells.map((cell) => {
            const content = renderInlineMarkdown(escapeHtml(cell));
            return `<${cellTag}>${content}</${cellTag}>`;
          });
          return `<tr>${htmlCells.join("")}</tr>`;
        };
        const headerRow = renderRow(padRow(header), "th");
        const bodyRows = rows
          .map((row) => renderRow(padRow(row), "td"))
          .join("");
        html += `<div class="md-table"><table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table></div>`;
      } else if (isUl) {
        html += "<ul>";
        let current = "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const mm = /^\s*[-*]\s+(.+)\s*$/.exec(line);
          if (mm) {
            if (current) {
              const item = renderInlineMarkdown(escapeHtml(current)).replace(
                /\n/g,
                "<br />",
              );
              html += `<li>${item}</li>`;
            }
            current = mm[1];
            continue;
          }
          if (/^\s{2,}\S/.test(line)) {
            current += `\n${line.replace(/^\s{2,}/, "")}`;
          }
        }
        if (current) {
          const item = renderInlineMarkdown(escapeHtml(current)).replace(
            /\n/g,
            "<br />",
          );
          html += `<li>${item}</li>`;
        }
        html += "</ul>";
      } else if (isOl) {
        html += "<ol>";
        let current = "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const mm = /^\s*\d+\.\s+(.+)\s*$/.exec(line);
          if (mm) {
            if (current) {
              const item = renderInlineMarkdown(escapeHtml(current)).replace(
                /\n/g,
                "<br />",
              );
              html += `<li>${item}</li>`;
            }
            current = mm[1];
            continue;
          }
          if (/^\s{2,}\S/.test(line)) {
            current += `\n${line.replace(/^\s{2,}/, "")}`;
          }
        }
        if (current) {
          const item = renderInlineMarkdown(escapeHtml(current)).replace(
            /\n/g,
            "<br />",
          );
          html += `<li>${item}</li>`;
        }
        html += "</ol>";
      } else if (lines.every((l) => /^\s*>/.test(l) || !l.trim())) {
        const quoted = lines
          .map((line) => line.replace(/^\s*> ?/, ""))
          .join("\n")
          .trimEnd();
        const escaped = renderInlineMarkdown(escapeHtml(quoted)).replace(
          /\n/g,
          "<br />",
        );
        html += `<blockquote><p>${escaped}</p></blockquote>`;
      } else if (hasHeading || hasRule || hasQuote) {
        let paragraph = [];
        let quoteBuffer = [];
        const flushParagraph = () => {
          if (!paragraph.length) return;
          const text = paragraph.join("\n").trimEnd();
          const escaped = renderInlineMarkdown(escapeHtml(text)).replace(
            /\n/g,
            "<br />",
          );
          html += `<p>${escaped}</p>`;
          paragraph = [];
        };
        const flushQuote = () => {
          if (!quoteBuffer.length) return;
          const text = quoteBuffer.join("\n").trimEnd();
          const escaped = renderInlineMarkdown(escapeHtml(text)).replace(
            /\n/g,
            "<br />",
          );
          html += `<blockquote><p>${escaped}</p></blockquote>`;
          quoteBuffer = [];
        };
        for (const line of lines) {
          const raw = line || "";
          const trimmedLine = raw.trim();
          if (!trimmedLine) {
            flushQuote();
            flushParagraph();
            continue;
          }
          const headingMatch = /^ {0,3}(#{1,6})\s+(.+)$/.exec(trimmedLine);
          if (headingMatch) {
            flushQuote();
            flushParagraph();
            const level = headingMatch[1].length;
            const text = headingMatch[2].trim();
            const escaped = renderInlineMarkdown(escapeHtml(text));
            html += `<h${level}>${escaped}</h${level}>`;
            continue;
          }
          if (/^ {0,3}(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
            flushQuote();
            flushParagraph();
            html += "<hr />";
            continue;
          }
          if (/^\s*>/.test(raw)) {
            flushParagraph();
            quoteBuffer.push(raw.replace(/^\s*> ?/, ""));
            continue;
          }
          flushQuote();
          paragraph.push(raw);
        }
        flushQuote();
        flushParagraph();
      } else {
        const escaped = renderInlineMarkdown(escapeHtml(trimmed)).replace(
          /\n/g,
          "<br />",
        );
        html += `<p>${escaped}</p>`;
      }
    }
  }
  return (
    html ||
    `<p>${renderInlineMarkdown(escapeHtml(src)).replace(/\n/g, "<br />")}</p>`
  );
}

export { renderMarkdownLite };

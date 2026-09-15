// frontend/src/shared/lib/renderMarkdown.js
// Lightweight markdown parser for chatbot messages.
// Handles: **bold**, numbered lists, bullet lists, line breaks, inline links.
// Internal links (/path) use data-route for in-app navigation.
// Sanitizes output to prevent XSS — only allows a safe whitelist of tags/attributes.

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(s) { return s.replace(/[&<>"']/g, c => ESCAPE_MAP[c]); }

// Strip HTML tags not in whitelist; preserve safe attributes on <a>
function sanitize(html) {
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/gi, (match, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!['strong', 'em', 'b', 'i', 'ol', 'ul', 'li', 'p', 'br', 'a'].includes(t)) return '';
    if (t === 'a') {
      // Closing tag </a> — pass through as-is
      if (match.startsWith('</')) return '</a>';
      // Opening tag — preserve only safe attributes
      const safe = attrs.match(/(?:href|data-route|target|rel)="[^"]*"/gi) || [];
      return `<a ${safe.join(' ')}>`;
    }
    return match;
  });
}

// Convert **bold**, *italic*, [text](url) to HTML
function inlineFormat(text) {
  let s = esc(text);
  // **bold**
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // *italic*
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // [text](url) — internal routes get data-route, external get href
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const trimmed = url.trim();
    if (trimmed.startsWith('/')) {
      return `<a data-route="${esc(trimmed)}">${label}</a>`;
    }
    return `<a href="${esc(trimmed)}" target="_blank" rel="noopener">${label}</a>`;
  });
  return s;
}

// Parse a message into HTML with inline formatting + lists
export function renderMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '';
  let inOl = false;
  let inUl = false;

  const closeLists = () => {
    if (inOl) { html += '</ol>\n'; inOl = false; }
    if (inUl) { html += '</ul>\n'; inUl = false; }
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Numbered list: "1. Something" or "1) Something"
    const olMatch = trimmed.match(/^\s*\d+[.)]\s+(.*)/);
    // Bullet list: "- Something" or "* Something"
    const ulMatch = trimmed.match(/^\s*[-*]\s+(.*)/);

    if (olMatch) {
      if (!inOl) { closeLists(); html += '<ol>\n'; inOl = true; }
      html += `<li>${inlineFormat(olMatch[1])}</li>\n`;
    } else if (ulMatch) {
      if (!inUl) { closeLists(); html += '<ul>\n'; inUl = true; }
      html += `<li>${inlineFormat(ulMatch[1])}</li>\n`;
    } else if (trimmed === '') {
      closeLists();
      if (!html.endsWith('<br><br>')) html += '<br>\n';
    } else {
      closeLists();
      html += `<p>${inlineFormat(trimmed)}</p>\n`;
    }
  }
  closeLists();
  return sanitize(html);
}

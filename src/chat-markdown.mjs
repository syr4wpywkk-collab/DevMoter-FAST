import createDOMPurify from "dompurify";
import { Marked } from "marked";
import { t } from "./i18n-core.mjs";

const purifiers = new WeakMap();
const allowedTags = [
  "p", "br", "hr", "strong", "em", "del", "blockquote", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr",
  "th", "td", "pre", "code", "a"
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function safeHref(value) {
  const href = String(value || "");
  // Check schemes after removing the control characters browsers ignore in URLs.
  const compact = href.replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (scheme && !/^(https?|mailto)$/i.test(scheme[1])) return null;
  return href;
}

function codeSource(token) {
  // How many terminal newlines Marked keeps in a fenced block differs between releases
  // and while streaming. Restore them from the source token; copy never reads the DOM.
  const opening = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(token.raw);
  if (!opening) return token.text;
  const lines = token.raw.slice(opening[0].length).split("\n");
  const fenceCharacter = opening[1][0] === "`" ? "`" : "~";
  const closing = new RegExp(`^ {0,3}${fenceCharacter}{${opening[1].length},}[ \\t]*$`);
  let lastLine = lines.length - 1;
  if (lines[lastLine] === "") lastLine -= 1;
  const hasClosingFence = lastLine >= 0 && closing.test(lines[lastLine]);
  const lineBreaks = hasClosingFence ? lastLine : lines.length - 1;
  const text = token.text.replace(/\n+$/, "");
  return text + "\n".repeat(Math.max(0, lineBreaks - (text.split("\n").length - 1)));
}

/** Render untrusted Markdown. Raw message state remains the caller's responsibility. */
export function renderChatMarkdown(target, rawText, onCopy) {
  const document = target.ownerDocument;
  const window = document.defaultView;
  if (!window) throw new Error("Markdown rendering requires a document window");
  let purifier = purifiers.get(window);
  if (!purifier) {
    purifier = createDOMPurify(window);
    purifiers.set(window, purifier);
  }

  const codeBlocks = [];
  const markdown = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      html(token) {
        return escapeHtml(token.text);
      },
      image(token) {
        // Attachments have their own UI; Markdown must not load remote resources.
        return escapeHtml(token.text || t("markdown.imageFallback"));
      },
      checkbox(token) {
        return token.checked ? "☑ " : "☐ ";
      },
      link(token) {
        const label = this.parser.parseInline(token.tokens);
        const href = safeHref(token.href);
        if (href === null) return label;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(href)}"${title}>${label}</a>`;
      },
      code(token) {
        const source = codeSource(token);
        const index = codeBlocks.push({ source, language: token.lang || "" }) - 1;
        return `<pre data-dm-code="${index}"><code>${escapeHtml(source)}</code></pre>`;
      }
    }
  });

  const html = markdown.parse(rawText, { async: false });
  const fragment = purifier.sanitize(html, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ["href", "title", "start", "align", "data-dm-code"],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true
  });

  for (const link of fragment.querySelectorAll("a")) {
    const href = link.getAttribute("href");
    if (!href || safeHref(href) === null) {
      link.removeAttribute("href");
      continue;
    }
    // Open web references separately so the active conversation stays reachable.
    const compact = href.replace(/[\u0000-\u0020]/g, "");
    let opensSeparately = /^(?:https?:|[/\\]{2})/i.test(compact);
    try {
      const resolved = new URL(href, document.baseURI);
      opensSeparately ||= /^https?:$/.test(resolved.protocol) && resolved.origin !== window.location.origin;
    } catch {
      // Relative references also work in documents without a URL base.
    }
    if (opensSeparately) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }

  for (const pre of fragment.querySelectorAll("pre[data-dm-code]")) {
    const block = codeBlocks[Number(pre.getAttribute("data-dm-code"))];
    pre.removeAttribute("data-dm-code");
    if (!block) continue;

    const wrapper = document.createElement("div");
    wrapper.className = "dm-code-block";
    const header = document.createElement("div");
    header.className = "dm-code-head";
    const language = document.createElement("span");
    language.className = "dm-code-language";
    language.textContent = block.language.split(/\s+/, 1)[0] || t("markdown.code");
    const copy = document.createElement("button");
    copy.className = "dm-code-copy";
    copy.type = "button";
    copy.textContent = t("common.copy");
    copy.setAttribute("aria-label", t("markdown.copyCodeAria"));
    copy.addEventListener("click", () => onCopy(block.source));
    // Long lines scroll sideways by default; wrapping is a per-block choice.
    const wrap = document.createElement("button");
    wrap.className = "dm-code-wrap";
    wrap.type = "button";
    wrap.textContent = t("markdown.wrapCode");
    wrap.setAttribute("aria-pressed", "false");
    wrap.addEventListener("click", () => {
      const wrapped = wrapper.dataset.wrap !== "true";
      wrapper.dataset.wrap = String(wrapped);
      wrap.setAttribute("aria-pressed", String(wrapped));
    });
    header.append(language, copy, wrap);
    pre.replaceWith(wrapper);
    wrapper.append(header, pre);
  }

  for (const table of fragment.querySelectorAll("table")) {
    const wrapper = document.createElement("div");
    wrapper.className = "dm-markdown-table";
    table.replaceWith(wrapper);
    wrapper.append(table);
  }

  target.classList.add("cx-markdown");
  target.replaceChildren(fragment);
}

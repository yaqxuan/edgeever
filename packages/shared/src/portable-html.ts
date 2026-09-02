import { Mark, mergeAttributes } from "@tiptap/core";
import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownRendererHelpers,
  MarkdownToken,
} from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";

export const PORTABLE_ABBR_MARK_TYPE = "edgeeverAbbr" as const;
export const PORTABLE_SUP_MARK_TYPE = "edgeeverSup" as const;
export const PORTABLE_SUB_MARK_TYPE = "edgeeverSub" as const;
export const PORTABLE_MARK_MARK_TYPE = "edgeeverMark" as const;
export const PORTABLE_UNDERLINE_MARK_TYPE = "edgeeverUnderline" as const;
export const PORTABLE_KBD_MARK_TYPE = "edgeeverKbd" as const;
export const PORTABLE_DETAILS_NODE_TYPE = "details" as const;
export const PORTABLE_DETAILS_SUMMARY_NODE_TYPE = "detailsSummary" as const;
export const PORTABLE_DETAILS_CONTENT_NODE_TYPE = "detailsContent" as const;

const PORTABLE_TAG_NAMES = [
  "abbr",
  "sup",
  "sub",
  "mark",
  "u",
  "kbd",
  "details",
  "summary",
  "strong",
  "em",
  "del",
] as const;
const PORTABLE_TAG_PATTERN_SOURCE = PORTABLE_TAG_NAMES.join("|");
const PORTABLE_MARK_TYPES = new Set<string>([
  PORTABLE_ABBR_MARK_TYPE,
  PORTABLE_SUP_MARK_TYPE,
  PORTABLE_SUB_MARK_TYPE,
  PORTABLE_MARK_MARK_TYPE,
  PORTABLE_UNDERLINE_MARK_TYPE,
  PORTABLE_KBD_MARK_TYPE,
]);
const PORTABLE_NODE_TYPES = new Set<string>([
  PORTABLE_DETAILS_NODE_TYPE,
  PORTABLE_DETAILS_SUMMARY_NODE_TYPE,
  PORTABLE_DETAILS_CONTENT_NODE_TYPE,
]);

const decodeHtmlEntities = (value: string) => value.replace(
  /&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[\da-f]{1,6});/gi,
  (entity) => {
    const normalized = entity.toLowerCase();
    if (normalized === "&amp;") return "&";
    if (normalized === "&quot;") return '"';
    if (normalized === "&apos;") return "'";
    if (normalized === "&lt;") return "<";
    if (normalized === "&gt;") return ">";
    const numeric = normalized.startsWith("&#x")
      ? Number.parseInt(normalized.slice(3, -1), 16)
      : Number.parseInt(normalized.slice(2, -1), 10);
    return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
      ? String.fromCodePoint(numeric)
      : entity;
  },
);

const escapeHtmlAttribute = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

/**
 * Markdown's text serializer escapes brackets even inside raw HTML. In a
 * portable HTML mark those backslashes would become visible in other readers,
 * so retain literal brackets after the full document has been serialized
 * (notably for <sup>[1]</sup> notes).
 */
const normalizePlainTextAttribute = (value: string) => decodeHtmlEntities(value)
  .replace(/[\u0000-\u001f\u007f]/gu, " ")
  .replace(/\s+/gu, " ")
  .trim()
  .slice(0, 500);

const readQuotedAttribute = (attributes: string, name: string) => {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = pattern.exec(attributes);
  return match ? normalizePlainTextAttribute(match[1] ?? match[2] ?? "") : "";
};

const hasBooleanAttribute = (attributes: string, name: string) =>
  new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?(?=\\s|$)`, "i")
    .test(attributes);

/**
 * Restores only the portable allowlist when an older rich editor escaped the
 * source tags. Everything else remains ordinary text for the Markdown parser.
 */
const transformOutsideInlineCode = (
  line: string,
  transform: (segment: string) => string,
) => {
  let output = "";
  let cursor = 0;

  while (cursor < line.length) {
    const openingIndex = line.indexOf("`", cursor);
    if (openingIndex < 0) {
      output += transform(line.slice(cursor));
      break;
    }

    let delimiterLength = 1;
    while (line[openingIndex + delimiterLength] === "`") delimiterLength += 1;
    const delimiter = "`".repeat(delimiterLength);
    let closingIndex = line.indexOf(delimiter, openingIndex + delimiterLength);
    while (
      closingIndex >= 0
      && (line[closingIndex - 1] === "`" || line[closingIndex + delimiterLength] === "`")
    ) {
      closingIndex = line.indexOf(delimiter, closingIndex + delimiterLength);
    }

    if (closingIndex < 0) {
      output += transform(line.slice(cursor));
      break;
    }

    output += transform(line.slice(cursor, openingIndex));
    output += line.slice(openingIndex, closingIndex + delimiterLength);
    cursor = closingIndex + delimiterLength;
  }

  return output;
};

/**
 * Applies legacy HTML recovery only where Markdown treats input as prose.
 * Literal examples in inline code, fenced code, or indented code must remain
 * byte-for-byte content instead of becoming editor marks.
 */
const transformMarkdownProse = (
  markdown: string,
  transform: (segment: string) => string,
) => {
  let activeFence: { character: "`" | "~"; length: number } | null = null;

  return markdown.replace(/[^\n]*(?:\n|$)/gu, (lineWithEnding) => {
    if (!lineWithEnding) return "";
    const hasNewline = lineWithEnding.endsWith("\n");
    const line = hasNewline ? lineWithEnding.slice(0, -1) : lineWithEnding;
    const fenceMatch = /^(?: {0,3}>\s*)* {0,3}(`{3,}|~{3,})/u.exec(line);

    if (activeFence) {
      if (
        fenceMatch
        && fenceMatch[1][0] === activeFence.character
        && fenceMatch[1].length >= activeFence.length
      ) {
        activeFence = null;
      }
      return lineWithEnding;
    }

    if (fenceMatch) {
      activeFence = {
        character: fenceMatch[1][0] as "`" | "~",
        length: fenceMatch[1].length,
      };
      return lineWithEnding;
    }

    if (/^(?: {0,3}>\s*)*(?: {4}|\t)/u.test(line)) return lineWithEnding;
    const transformed = transformOutsideInlineCode(line, transform);
    return hasNewline ? `${transformed}\n` : transformed;
  });
};

const normalizePortableHtmlProseSegment = (segment: string) => {
  const escapedTagPattern = new RegExp(
    `\\\\(<\\/?(?:${PORTABLE_TAG_PATTERN_SOURCE})\\b[^>]*>)`,
    "gi",
  );
  const entityTagPattern = new RegExp(
    `&lt;(\\/?(?:${PORTABLE_TAG_PATTERN_SOURCE})\\b[^\\r\\n]*?)&gt;`,
    "gi",
  );

  let normalized = segment
    .replace(escapedTagPattern, "$1")
    .replace(entityTagPattern, (_match, tagBody: string) => `<${decodeHtmlEntities(tagBody)}>`);

  const standardMarks = [
    { tag: "strong", marker: "**" },
    { tag: "em", marker: "*" },
    { tag: "del", marker: "~~" },
  ] as const;
  for (const { tag, marker } of standardMarks) {
    const pairPattern = new RegExp(`<${tag}\\b[^>]*>([^\\r\\n]*?)<\\/${tag}\\s*>`, "gi");
    for (let pass = 0; pass < 8 && pairPattern.test(normalized); pass += 1) {
      pairPattern.lastIndex = 0;
      normalized = normalized.replace(pairPattern, `${marker}$1${marker}`);
    }
  }

  return normalized;
};

export const normalizePortableHtmlMarkdown = (markdown: string) =>
  transformMarkdownProse(markdown, normalizePortableHtmlProseSegment);

/**
 * Markdown's serializer escapes brackets even inside raw HTML. Keep brackets
 * literal for portable marks, but never alter HTML shown as a code example.
 */
export const normalizePortableHtmlSerialization = (markdown: string) =>
  transformMarkdownProse(
    markdown,
    (segment) => segment.replace(
      /<(abbr|sup|sub|mark|u|kbd)\b([^>]*)>([^<\r\n]*)<\/\1\s*>/giu,
      (_match, tag: string, attributes: string, content: string) =>
        `<${tag}${attributes}>${content.replace(/\\([\[\]])/gu, "$1")}</${tag}>`,
    ),
  );

export const containsPortableHtmlSource = (markdown: string) => {
  const normalized = normalizePortableHtmlMarkdown(markdown);
  return new RegExp(`<(?:abbr|sup|sub|mark|u|kbd|details)\\b`, "i").test(normalized);
};

export const docContainsPortableHtml = (doc: unknown): boolean => {
  if (!doc || typeof doc !== "object") return false;
  const node = doc as {
    type?: unknown;
    marks?: Array<{ type?: unknown }>;
    content?: unknown[];
  };
  if (typeof node.type === "string" && PORTABLE_NODE_TYPES.has(node.type)) return true;
  if (node.marks?.some((mark) => typeof mark.type === "string" && PORTABLE_MARK_TYPES.has(mark.type))) {
    return true;
  }
  return Array.isArray(node.content) && node.content.some(docContainsPortableHtml);
};

type PortableInlineToken = MarkdownToken & {
  tokens?: MarkdownToken[];
  portableAttributes?: Record<string, unknown>;
};

type PortableMarkDefinition = {
  name: string;
  tag: "abbr" | "sup" | "sub" | "mark" | "u" | "kbd";
  className: string;
  parseAttributes?: (source: string) => Record<string, unknown>;
  renderAttributes?: (attributes: Record<string, unknown>) => Record<string, string>;
};

const createPortableHtmlMark = ({
  name,
  tag,
  className,
  parseAttributes = () => ({}),
  renderAttributes = () => ({}),
}: PortableMarkDefinition) => Mark.create({
  name,
  inclusive: false,

  addAttributes() {
    return tag === "abbr"
      ? {
          title: {
            default: "",
            parseHTML: (element: HTMLElement) => normalizePlainTextAttribute(element.getAttribute("title") ?? ""),
          },
        }
      : {};
  },

  parseHTML() {
    return [{ tag }];
  },

  renderHTML({ HTMLAttributes }) {
    const safeAttributes = renderAttributes(HTMLAttributes as Record<string, unknown>);
    const { title: _nativeTitle, ...domAttributes } = safeAttributes;
    return [
      tag,
      mergeAttributes({ class: className }, domAttributes),
      0,
    ];
  },

  markdownTokenName: name,

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    const portableToken = token as PortableInlineToken;
    return helpers.applyMark(
      name,
      helpers.parseInline(portableToken.tokens ?? []),
      portableToken.portableAttributes,
    );
  },

  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers) {
    const attributes = renderAttributes((node.attrs ?? {}) as Record<string, unknown>);
    const serializedAttributes = Object.entries(attributes)
      .filter(([key]) => key === "title")
      .map(([key, value]) => ` ${key}="${escapeHtmlAttribute(value)}"`)
      .join("");
    return `<${tag}${serializedAttributes}>${helpers.renderChildren(node)}</${tag}>`;
  },

  markdownOptions: {
    htmlReopen: {
      open: `<${tag}>`,
      close: `</${tag}>`,
    },
  },

  markdownTokenizer: {
    name,
    level: "inline" as const,
    start(source: string) {
      return source.toLowerCase().indexOf(`<${tag}`);
    },
    tokenize(source: string, _tokens: MarkdownToken[], lexer: { inlineTokens: (value: string) => MarkdownToken[] }) {
      const match = new RegExp(`^<${tag}\\b([^>]*)>([^\\r\\n]*?)<\\/${tag}\\s*>`, "i").exec(source);
      if (!match) return undefined;
      return {
        type: name,
        raw: match[0],
        text: match[2],
        tokens: lexer.inlineTokens(match[2]),
        portableAttributes: parseAttributes(match[1]),
      };
    },
  },
});

const PortableAbbr = createPortableHtmlMark({
  name: PORTABLE_ABBR_MARK_TYPE,
  tag: "abbr",
  className: "edgeever-portable-abbr",
  parseAttributes: (source) => ({ title: readQuotedAttribute(source, "title") }),
  renderAttributes: (attributes): Record<string, string> => {
    const title = normalizePlainTextAttribute(typeof attributes.title === "string" ? attributes.title : "");
    return title
      ? {
          title,
          "data-edgeever-abbr-title": title,
          tabindex: "0",
        }
      : {};
  },
});

const PortableSup = createPortableHtmlMark({
  name: PORTABLE_SUP_MARK_TYPE,
  tag: "sup",
  className: "edgeever-portable-sup",
  renderAttributes: () => ({ "data-edgeever-footnote": "true", tabindex: "0" }),
});

const PortableSub = createPortableHtmlMark({
  name: PORTABLE_SUB_MARK_TYPE,
  tag: "sub",
  className: "edgeever-portable-sub",
});

const PortableMark = createPortableHtmlMark({
  name: PORTABLE_MARK_MARK_TYPE,
  tag: "mark",
  className: "edgeever-portable-mark",
});

const PortableUnderline = createPortableHtmlMark({
  name: PORTABLE_UNDERLINE_MARK_TYPE,
  tag: "u",
  className: "edgeever-portable-underline",
});

const PortableKbd = createPortableHtmlMark({
  name: PORTABLE_KBD_MARK_TYPE,
  tag: "kbd",
  className: "edgeever-portable-kbd",
});

type PortableDetailsToken = MarkdownToken & {
  open?: boolean;
  summaryTokens?: MarkdownToken[];
  contentTokens?: MarkdownToken[];
};

const PortableDetails = Details.extend({
  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (element: HTMLElement) => element.hasAttribute("open"),
        renderHTML: ({ open }: { open?: boolean }) => (open ? { open: "" } : {}),
      },
    };
  },

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    const detailsToken = token as PortableDetailsToken;
    const content = helpers.parseChildren(detailsToken.contentTokens ?? []);
    return helpers.createNode(PORTABLE_DETAILS_NODE_TYPE, { open: Boolean(detailsToken.open) }, [
      helpers.createNode(
        PORTABLE_DETAILS_SUMMARY_NODE_TYPE,
        {},
        helpers.parseInline(detailsToken.summaryTokens ?? []),
      ),
      helpers.createNode(
        PORTABLE_DETAILS_CONTENT_NODE_TYPE,
        {},
        content.length > 0 ? content : [helpers.createNode("paragraph")],
      ),
    ]);
  },

  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers) {
    const summary = node.content?.find((child) => child.type === PORTABLE_DETAILS_SUMMARY_NODE_TYPE);
    const content = node.content?.find((child) => child.type === PORTABLE_DETAILS_CONTENT_NODE_TYPE);
    const open = node.attrs?.open ? " open" : "";
    const summaryMarkdown = summary ? helpers.renderChildren(summary.content ?? []) : "";
    // Block children (lists, quotes, paragraphs, and so on) need the same
    // separator used at the document level. Rendering the wrapper node alone
    // concatenates them and turns otherwise valid Markdown into a different
    // document on the next import.
    const contentMarkdown = content
      ? helpers.renderChildren(content.content ?? [], "\n\n").trim()
      : "";
    return `<details${open}>\n<summary>${summaryMarkdown}</summary>\n\n${contentMarkdown}\n</details>`;
  },

  addNodeView() {
    return ({ editor, node, HTMLAttributes }) => {
      let currentNode = node;
      let isOpen = Boolean(node.attrs.open);
      const dom = document.createElement("div");
      const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": this.name,
      });
      Object.entries(attributes).forEach(([key, value]) => dom.setAttribute(key, String(value)));

      const toggle = document.createElement("button");
      toggle.type = "button";
      const content = document.createElement("div");
      dom.appendChild(toggle);
      dom.appendChild(content);

      const renderToggleButton = () => {
        this.options.renderToggleButton({ element: toggle, isOpen, node: currentNode });
      };
      const notifyContent = () => {
        const event = new Event("toggleDetailsContent");
        content.querySelector(':scope > div[data-type="detailsContent"]')?.dispatchEvent(event);
      };
      const applyOpenState = (nextOpen: boolean) => {
        if (nextOpen === isOpen) {
          renderToggleButton();
          return;
        }
        isOpen = nextOpen;
        dom.classList.toggle(this.options.openClassName, isOpen);
        renderToggleButton();
        notifyContent();
      };
      const handleToggle = () => {
        applyOpenState(!isOpen);
        if (editor.isEditable) editor.commands.focus(undefined, { scrollIntoView: false });
      };

      dom.classList.toggle(this.options.openClassName, isOpen);
      renderToggleButton();
      if (isOpen) setTimeout(notifyContent);
      toggle.addEventListener("click", handleToggle);

      return {
        dom,
        contentDOM: content,
        ignoreMutation(mutation) {
          if (mutation.type === "selection") return false;
          const target = mutation.target;
          return toggle.contains(target) || !dom.contains(target) || dom === target;
        },
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) return false;
          const authoredOpenChanged = updatedNode.attrs.open !== currentNode.attrs.open;
          currentNode = updatedNode;
          if (authoredOpenChanged) applyOpenState(Boolean(updatedNode.attrs.open));
          else renderToggleButton();
          return true;
        },
        destroy() {
          toggle.removeEventListener("click", handleToggle);
        },
      };
    };
  },

  markdownTokenizer: {
    name: PORTABLE_DETAILS_NODE_TYPE,
    level: "block" as const,
    start(source: string) {
      return source.toLowerCase().indexOf("<details");
    },
    tokenize(source: string, _tokens: MarkdownToken[], lexer: {
      inlineTokens: (value: string) => MarkdownToken[];
      blockTokens: (value: string) => MarkdownToken[];
    }) {
      const match = /^<details\b([^>]*)>\s*<summary\b[^>]*>([^\r\n]*?)<\/summary\s*>\s*([\s\S]*?)<\/details\s*>(?:\n|$)/i.exec(source);
      if (!match) return undefined;
      const body = match[3].trim();
      return {
        type: PORTABLE_DETAILS_NODE_TYPE,
        raw: match[0],
        open: hasBooleanAttribute(match[1], "open"),
        summaryTokens: lexer.inlineTokens(match[2]),
        contentTokens: body ? lexer.blockTokens(body) : [],
      };
    },
  },
});

const PortableDetailsSummary = DetailsSummary.extend({
  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers) {
    return helpers.renderChildren(node);
  },
});

const PortableDetailsContent = DetailsContent.extend({
  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers) {
    return helpers.renderChildren(node);
  },
});

/** A fresh extension list for each Markdown manager or editor instance. */
export const createPortableHtmlExtensions = () => [
  PortableAbbr.configure(),
  PortableSup.configure(),
  PortableSub.configure(),
  PortableMark.configure(),
  PortableUnderline.configure(),
  PortableKbd.configure(),
  PortableDetails.configure({
    persist: false,
    openClassName: "is-open",
    HTMLAttributes: { class: "edgeever-portable-details" },
    renderToggleButton: ({ element, isOpen }: { element: HTMLButtonElement; isOpen: boolean }) => {
      element.className = "edgeever-portable-details-toggle";
      element.textContent = isOpen ? "▾" : "▸";
      element.setAttribute("aria-label", isOpen ? "收起折叠内容" : "展开折叠内容");
    },
  }),
  PortableDetailsSummary.configure({
    HTMLAttributes: { class: "edgeever-portable-details-summary" },
  }),
  PortableDetailsContent.configure({
    HTMLAttributes: { class: "edgeever-portable-details-content" },
  }),
];

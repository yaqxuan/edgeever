import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";

const isEscaped = (source: string, index: number) => {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
};

const findClosingDelimiter = (source: string, delimiter: string, from: number) => {
  for (let index = from; index <= source.length - delimiter.length; index += 1) {
    if (source.startsWith(delimiter, index) && !isEscaped(source, index)) return index;
  }
  return -1;
};

const EdgeEverInlineMath = InlineMath.extend({
  renderMarkdown: (node) => /^\d+(?:[.,]\d+)?$/u.test(node.attrs?.latex || "")
    ? `\\(${node.attrs?.latex}\\)`
    : `$${node.attrs?.latex || ""}$`,
  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start: (source: string) => source.search(/\$|\\[()[\]]/u),
    tokenize: (source: string) => {
      // Keep serialized literal square-bracket delimiters literal on re-import.
      if (source.startsWith("\\\\\\[") || source.startsWith("\\\\\\]")) {
        return { type: "text", raw: source.slice(0, 4), text: source.slice(2, 4) };
      }
      if (source.startsWith("\\(")) {
        const closingIndex = findClosingDelimiter(source, "\\)", 2);
        if (closingIndex < 0) return { type: "text", raw: "\\(", text: "\\(" };
        const latex = source.slice(2, closingIndex).trim();
        if (!latex || latex.includes("\n")) return { type: "text", raw: "\\(", text: "\\(" };
        return { type: "inlineMath", raw: source.slice(0, closingIndex + 2), latex };
      }
      if (/^\\[)[\]]/u.test(source)) {
        return { type: "text", raw: source.slice(0, 2), text: source.slice(0, 2) };
      }
      if (!source.startsWith("$") || source.startsWith("$$")) return undefined;
      const closingIndex = findClosingDelimiter(source, "$", 1);
      if (closingIndex < 0 || source[closingIndex + 1] === "$") return undefined;
      const raw = source.slice(0, closingIndex + 1);
      const latex = source.slice(1, closingIndex).trim();
      if (!latex || latex.includes("\n")) return undefined;
      if (/^\d+(?:[.,]\d+)?$/u.test(latex)) return { type: "text", raw, text: raw };
      return { type: "inlineMath", raw, latex };
    },
  },
});

const EdgeEverBlockMath = BlockMath.extend({
  markdownTokenizer: {
    name: "blockMath",
    level: "block",
    start: (source: string) => source.search(/^(?:\$\$|\\\[)/mu),
    tokenize: (source: string) => {
      if (source.startsWith("\\[")) {
        const closingIndex = findClosingDelimiter(source, "\\]", 2);
        if (closingIndex < 0) return undefined;
        const latex = source.slice(2, closingIndex).trim();
        if (!latex) return undefined;
        return { type: "blockMath", raw: source.slice(0, closingIndex + 2), latex };
      }
      if (!source.startsWith("$$") || source.startsWith("$$$")) return undefined;
      const closingIndex = findClosingDelimiter(source, "$$", 2);
      if (closingIndex < 0) return undefined;
      const latex = source.slice(2, closingIndex).trim();
      if (!latex) return undefined;
      return { type: "blockMath", raw: source.slice(0, closingIndex + 2), latex };
    },
  },
});

const katexOptions = { throwOnError: false, strict: "warn" as const, trust: false };

/** Keep in sync with packages/shared/src/mathematics.ts. */
export const createEdgeEverMathematics = () => [
  EdgeEverBlockMath.configure({ katexOptions }),
  EdgeEverInlineMath.configure({ katexOptions }),
];

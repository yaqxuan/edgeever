import { describe, expect, test } from "bun:test";
import { markdownToDoc, docToMarkdown, docToText } from "./content.ts";
import { readFileSync } from "node:fs";
import { createEdgeEverMathematics } from "./mathematics.ts";

describe("LaTeX bracket delimiters", () => {
  test("keeps incomplete delimiters as source", () => {
    for (const source of [String.raw`\(x`, String.raw`\[x`, String.raw`\(\)`, String.raw`prefix \[x`, String.raw`\[\]`]) {
      const doc = markdownToDoc(source);
      expect(docToText(doc)).toBe(source);
      expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
    }
  });
  test("recognizes inline commands and numeric formulas before Markdown escapes", () => {
    const doc = markdownToDoc(String.raw`角频率 \(\omega\)，数值 \(2\)。`);
    expect(doc.content[0].content?.filter(n => n.type === "inlineMath").map(n => n.attrs?.latex))
      .toEqual([String.raw`\omega`, "2"]);
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });

  for (const latex of [
    String.raw`y=A\sin(\omega t+\phi)`,
    String.raw`\boxed{T=\frac{2\pi}{|\omega|}}`,
    String.raw`N(t)=N_0e^{kt},\quad k>0`,
    String.raw`0<x<1,\quad x\leq y`,
    String.raw`\unknownCommand{x}`,
    String.raw`\text{向左平移 }\frac{\pi}{12}`,
    String.raw`\begin{matrix}a & b\\c & d\end{matrix}`,
    "2",
  ]) {
    test(`preserves block formula ${latex}`, () => {
      const doc = markdownToDoc(`\\[\n${latex}\n\\]`);
      expect(doc.content[0]).toMatchObject({type: "blockMath", attrs: {latex}});
      expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
    });
  }

  test("does not interpret code, ordinary parentheses, currency, or attributes", () => {
    const source = String.raw`(x) [y] $100$ <abbr title="\(x\)">HTML</abbr>

\`\(x\)\`

~~~latex
\[x\]
~~~

    \[x\]
`.replaceAll("\\`", "`");
    const doc = markdownToDoc(source);
    expect(JSON.stringify(doc)).not.toMatch(/"(?:inlineMath|blockMath)"/);
  });

  test("retains HTML formatting around formulas and inside details", () => {
    const doc = markdownToDoc(String.raw`<mark>周期</mark> \(T\)

<details open>
<summary>公式</summary>

\[
T=\frac{2\pi}{|\omega|}
\]
</details>`);
    expect(JSON.stringify(doc)).toContain('"inlineMath"');
    expect(JSON.stringify(doc)).toContain('"blockMath"');
    expect(JSON.stringify(doc)).toContain('"edgeeverMark"');
    expect(markdownToDoc(docToMarkdown(doc))).toEqual(doc);
  });

  test("keeps the standalone iOS tokenizers and serializers aligned", () => {
    const shared = createEdgeEverMathematics();
    // iOS installs its own dependency tree outside the root workspace. Exercise
    // its actual pure tokenizer definitions without loading browser renderers.
    const source = readFileSync(new URL("../../../apps/ios/EditorSource/src/mathematics.ts", import.meta.url), "utf8")
      .replace(/^import .*;\n/m, "")
      .split("const katexOptions")[0];
    const compiled = new Bun.Transpiler({loader: "ts"}).transformSync(source);
    const stub = {extend: config => ({config})};
    const ios = new Function("InlineMath", "BlockMath", `${compiled}; return [EdgeEverBlockMath, EdgeEverInlineMath];`)(stub, stub);
    const samples = [String.raw`\(x_0\)`, String.raw`\[x<2\]`,
      String.raw`\[\begin{matrix}a&b\\c&d\end{matrix}\]`,
      String.raw`\(x`, String.raw`\[x`, String.raw`\\\[x`,
      "$x$", "$$x$$", "$100$", "(x)", String.raw`\(\)`];
    for (let index = 0; index < shared.length; index++) {
      for (const sample of samples) {
        const a = shared[index].config.markdownTokenizer;
        const b = ios[index].config.markdownTokenizer;
        expect(b.start(sample)).toBe(a.start(sample));
        expect(b.tokenize(sample)).toEqual(a.tokenize(sample));
      }
    }
    expect(ios[1].config.renderMarkdown({attrs: {latex: "2"}})).toBe(String.raw`\(2\)`);
  });
});

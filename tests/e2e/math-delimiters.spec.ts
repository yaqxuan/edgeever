import { expect, test } from "@playwright/test";

test("bracket formulas survive editing, reopening, sharing and Markdown export", async ({ page }) => {
  const title = `math-delimiters-${Date.now()}`;
  const notebooks = await (await page.request.get("/api/v1/notebooks")).json();
  const source = String.raw`<mark>公式验收</mark> 行内 \(\omega_0\) 与 $x^2$，金额 $100$。

\[
y=A\sin(\omega t+\phi),\quad 0<x<1
\]

\[
\begin{matrix}a&b\\c&d\end{matrix}
\]

$$
\boxed{\frac{1}{2}}+\text{中文}
$$

代码：\`\(not math\)\`

<details open>
<summary>折叠公式</summary>

\[
N(t)=N_0e^{kt}
\]
</details>` .replaceAll("\\`", "`");
  const response = await page.request.post("/api/v1/memos", {
    data: {notebookId: notebooks.notebooks[0].id, title, contentMarkdown: source},
  });
  expect(response.status()).toBe(201);
  const {memo} = await response.json();
  try {
    await page.goto("/");
    await page.getByRole("button", {name: "全部笔记", exact: true}).click();
    await page.getByPlaceholder("搜索笔记").fill(title);
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    const editor = page.locator(".ProseMirror").first();
    await expect(editor.locator(".katex")).toHaveCount(6);
    await expect(editor.locator(".katex-error")).toHaveCount(0);
    await expect(editor.locator("mark")).toHaveText("公式验收");
    await expect(editor.locator("code")).toHaveText(String.raw`\(not math\)`);
    await page.getByLabel("切换到 Markdown 源码", {exact: true}).click();
    await expect(page.getByLabel("Markdown 源码", {exact: true})).toContainText(String.raw`\omega_0`);
    await page.getByLabel("切换到富文本编辑", {exact: true}).click();
    await expect(editor.locator(".katex")).toHaveCount(6);
    await editor.locator("p").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" SAVE-CHECK");
    await expect.poll(async () => (await (await page.request.get(`/api/v1/memos/${memo.id}`)).json()).memo.contentMarkdown).toContain("SAVE-CHECK");
    await page.reload();
    await expect(editor.locator(".katex")).toHaveCount(6);
    await page.getByLabel("笔记更多操作", {exact: true}).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("menuitem", {name: "导出 Markdown", exact: true}).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const exported = Buffer.concat(chunks).toString("utf8");
    expect(exported).toContain(String.raw`\omega_0`);
    expect(exported).toContain(String.raw`a&b\\c&d`);
    const shareResponse = await page.request.post(`/api/v1/memos/${memo.id}/share`);
    expect(shareResponse.ok()).toBe(true);
    const {share} = await shareResponse.json();
    await page.goto(`/share/${encodeURIComponent(share.token)}`);
    await expect(page.locator(".edgeever-public-share .katex")).toHaveCount(6);
    await expect(page.locator(".katex-error")).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/v1/memos/${memo.id}/share`);
    await page.request.delete(`/api/v1/memos/${memo.id}`);
  }
});

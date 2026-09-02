import { expect, test } from "@playwright/test";

// The local Worker may serialise D1 reads while the offline-sync regression
// portion runs, so keep this cross-surface test independent of that delay.
test.setTimeout(90_000);

test("renders portable safe HTML styles in public share", async ({ page }) => {
  const marker = `portable-html-share-${Date.now()}`;
  await expect.poll(async () => (await page.request.get("/api/health")).ok()).toBe(true);
  const notebooksResponse = await page.request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const notebooks = await notebooksResponse.json() as { notebooks: Array<{ id: string }> };
  const notebookId = notebooks.notebooks[0]?.id;
  expect(notebookId).toBeTruthy();

  const contentMarkdown = [
    '<abbr title="令人震惊的；惊人的"><strong>staggering</strong></abbr> <sup>[1]</sup>',
    '<span style="color: #dc2626; background-color: #fef08a; font-size: 18px">醒目文字</span>',
    "<details open>",
    "<summary>折叠标题</summary>",
    "",
    "折叠区域里的 **Markdown** 内容。",
    "</details>",
  ].join("\n\n");
  const createResponse = await page.request.post("/api/v1/memos", {
    data: { notebookId, title: marker, contentMarkdown },
  });
  expect(createResponse.status()).toBe(201);
  const memo = (await createResponse.json() as { memo: { id: string } }).memo;
  let shareToken = "";

  try {
    const shareResponse = await page.request.post(`/api/v1/memos/${memo.id}/share`);
    expect(shareResponse.ok()).toBe(true);
    shareToken = (await shareResponse.json() as { share: { token: string } }).share.token;
    await page.goto(`/share/${encodeURIComponent(shareToken)}`);

    const sharedEditor = page.locator(".edgeever-public-share .ProseMirror");
    await expect(sharedEditor).toBeVisible({ timeout: 30_000 });
    await expect(sharedEditor.locator("abbr.edgeever-portable-abbr")).toHaveText("staggering");
    await expect(sharedEditor.locator("sup.edgeever-portable-sup")).toHaveText("[1]");
    const styledText = sharedEditor.locator("span.edgeever-portable-text-style");
    await expect(styledText).toHaveText("醒目文字");
    await expect(styledText).toHaveCSS("color", "rgb(220, 38, 38)");
    await expect(styledText).toHaveCSS("background-color", "rgb(254, 240, 138)");
    await expect(styledText).toHaveCSS("font-size", "18px");
    await expect(sharedEditor.locator(".edgeever-portable-details")).toContainText("折叠区域里的 Markdown 内容");
  } finally {
    if (shareToken) await page.request.delete(`/api/v1/memos/${memo.id}/share`);
    await page.request.delete(`/api/v1/memos/${memo.id}`);
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
  }
});

test("renders portable safe HTML in desktop and mobile web", async ({ page }) => {
  const marker = `portable-html-${Date.now()}`;
  await expect.poll(async () => (await page.request.get("/api/health")).ok()).toBe(true);
  const notebooksResponse = await page.request.get("/api/v1/notebooks");
  expect(notebooksResponse.ok()).toBe(true);
  const notebooks = await notebooksResponse.json() as { notebooks: Array<{ id: string }> };
  const notebookId = notebooks.notebooks[0]?.id;
  expect(notebookId).toBeTruthy();

  const contentMarkdown = [
    `这是 ${marker} 的测试笔记。`,
    "",
    'This result was <abbr title="令人震惊的；惊人的"><strong>staggering</strong></abbr> <sup>[1]</sup>。',
    "",
    "<sub>下标</sub> <mark>高亮</mark> <u>下划线</u> <kbd>Ctrl</kbd>",
    '<span style="color: #dc2626; background-color: #fef08a; font-size: 18px">醒目文字</span>',
    "",
    ...Array.from({ length: 28 }, (_, index) => `过渡段落 ${index + 1}：用于验证跳到注释。\n`),
    "### [1] 注释标题",
    "",
    "这里是第一条注释的预览内容。",
    "",
    "<details open>",
    "<summary>折叠标题</summary>",
    "",
    "折叠区域里的 **Markdown** 内容。",
    "</details>",
  ].join("\n");
  const createResponse = await page.request.post("/api/v1/memos", {
    data: { notebookId, title: marker, contentMarkdown },
  });
  expect(createResponse.status()).toBe(201);
  const memo = (await createResponse.json() as { memo: { id: string } }).memo;

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(marker);
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();

    const editor = page.locator(".ProseMirror").first();
    const abbr = editor.locator("abbr.edgeever-portable-abbr");
    const footnote = editor.locator("sup.edgeever-portable-sup");
    await expect(abbr).toHaveText("staggering");
    await expect(abbr).not.toHaveAttribute("title", /.+/u);
    await expect(editor.locator("sub.edgeever-portable-sub")).toHaveText("下标");
    await expect(editor.locator("mark.edgeever-portable-mark")).toHaveText("高亮");
    await expect(editor.locator("u.edgeever-portable-underline")).toHaveText("下划线");
    await expect(editor.locator("kbd.edgeever-portable-kbd")).toHaveText("Ctrl");
    const styledText = editor.locator("span.edgeever-portable-text-style");
    await expect(styledText).toHaveText("醒目文字");
    await expect(styledText).toHaveCSS("color", "rgb(220, 38, 38)");
    await expect(styledText).toHaveCSS("background-color", "rgb(254, 240, 138)");
    await expect(styledText).toHaveCSS("font-size", "18px");

    await page.getByRole("button", { name: "切换到 Markdown 源码" }).click();
    const markdownEditor = page.getByLabel("Markdown 源码");
    await expect(markdownEditor).toContainText('<abbr title="令人震惊的；惊人的">');
    await expect(markdownEditor).toContainText("<sup>[1]</sup>");
    await expect(markdownEditor).toContainText('<span style="color: #dc2626; background-color: #fef08a; font-size: 18px">醒目文字</span>');
    await page.getByRole("button", { name: "切换到富文本编辑" }).click();
    await expect(abbr).toHaveText("staggering");

    await expect(page.locator(".edgeever-portable-tooltip-anchor")).toHaveCount(1);
    await abbr.hover();
    await expect(page.locator("[data-edgeever-portable-tooltip]")).toContainText("令人震惊的；惊人的");
    await footnote.hover();
    const footnoteTooltip = page.locator("[data-edgeever-portable-tooltip]");
    await expect(footnoteTooltip).toContainText("这里是第一条注释的预览内容");
    await footnote.click();
    await footnoteTooltip.getByRole("button", { name: "跳到注释" }).click();
    const footnoteHeading = editor.getByRole("heading", { level: 3, name: "[1] 注释标题" });
    const viewportHeight = page.viewportSize()?.height ?? 720;
    await expect.poll(async () => {
      const box = await footnoteHeading.boundingBox();
      return Boolean(box && box.y >= 0 && box.y < viewportHeight);
    }).toBe(true);

    const details = editor.locator(".edgeever-portable-details");
    const detailsContent = details.locator(".edgeever-portable-details-content");
    await expect(details).toContainText("折叠标题");
    await expect(detailsContent).toBeVisible();
    await details.getByRole("button", { name: "收起折叠内容" }).click();
    await expect(detailsContent).toBeHidden();

    const storedAfterReading = await page.request.get(`/api/v1/memos/${memo.id}`);
    const storedAfterReadingBody = await storedAfterReading.json() as { memo: { contentMarkdown: string } };
    expect(storedAfterReadingBody.memo.contentMarkdown).toContain("<details open>");
    expect(storedAfterReadingBody.memo.contentMarkdown).toContain('<abbr title="令人震惊的；惊人的">');

    const firstParagraph = editor.locator("p").first();
    await firstParagraph.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" EDIT-CHECK");
    await expect(firstParagraph).toContainText("EDIT-CHECK");
    await expect(detailsContent).toBeHidden();
    await page.keyboard.press("Control+z");
    await expect(firstParagraph).not.toContainText("EDIT-CHECK");
    await expect(detailsContent).toBeHidden();
    await page.keyboard.press("Control+Shift+z");
    await expect(firstParagraph).toContainText("EDIT-CHECK");
    await expect(detailsContent).toBeHidden();
    // The web editor is offline-first. Confirm that its automatic save has
    // reached durable local storage by reloading and reopening the memo.
    await page.waitForTimeout(1_500);
    await page.reload();
    await page.getByRole("button", { name: "全部笔记", exact: true }).click();
    await page.getByPlaceholder("搜索笔记").fill(marker);
    await page.locator(`[data-memo-id="${memo.id}"]`).locator("button").first().click();
    await expect(editor.locator("p").first()).toContainText("EDIT-CHECK");

    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expect.poll(() => editor.locator("mark.edgeever-portable-mark").evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )).toBe("rgb(133, 77, 14)");
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/mobile-edit.html#memoId=${encodeURIComponent(memo.id)}&returnTo=/`);
    const mobileEditor = page.locator(".edgeever-mobile-tiptap-content");
    await expect(mobileEditor).toBeVisible();
    const mobileAbbr = mobileEditor.locator("abbr.edgeever-portable-abbr");
    await expect(mobileAbbr).toHaveText("staggering");
    await expect(mobileEditor.locator("span.edgeever-portable-text-style")).toHaveText("醒目文字");
    await mobileAbbr.click();
    await expect(page.locator("[data-edgeever-portable-tooltip]")).toContainText("令人震惊的；惊人的");
    await mobileEditor.locator("sup.edgeever-portable-sup").click();
    await expect(page.locator("[data-edgeever-portable-tooltip]")).toContainText("这里是第一条注释的预览内容");
  } finally {
    await page.request.delete(`/api/v1/memos/${memo.id}`);
    await page.request.delete(`/api/v1/memos/${memo.id}?permanent=1`);
  }
});

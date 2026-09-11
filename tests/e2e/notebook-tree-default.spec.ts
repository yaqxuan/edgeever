import { expect, test } from "@playwright/test";

test("notebook branches start collapsed and remain collapsed after refresh", async ({ page }) => {
  const name = `collapsed-tree-${Date.now()}`;
  const parentResponse = await page.request.post("/api/v1/notebooks", {data: {name}});
  expect(parentResponse.status()).toBe(201);
  const {notebook: parent} = await parentResponse.json();
  let childId: string | undefined;
  try {
    const response = await page.request.post("/api/v1/notebooks", {data: {name: `${name}-child`, parentId: parent.id}});
    expect(response.status()).toBe(201);
    childId = (await response.json()).notebook.id;
    await page.goto("/");
    await page.getByRole("button", {name: "全部笔记", exact: true}).click();
    const expand = page.getByRole("button", {name: `展开 ${name}`, exact: true});
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expand.click();
    await expect(page.getByRole("button", {name: `收起 ${name}`, exact: true})).toHaveAttribute("aria-expanded", "true");
    await page.reload();
    await expect(expand).toHaveAttribute("aria-expanded", "false");
  } finally {
    if (childId) await page.request.delete(`/api/v1/notebooks/${childId}`);
    await page.request.delete(`/api/v1/notebooks/${parent.id}`);
  }
});

import { test, expect } from "@playwright/test";

test.describe("map orders smoke", () => {
  test("главная страница загружается", async ({ page }) => {
    await page.goto("/map-orders");
    await expect(page.getByText("Параметры решателя")).toBeVisible();
    await expect(page.getByText("Карта заказов")).toBeVisible();
    await expect(page.getByText("Таблица заказов")).toBeVisible();
  });

  test("таблица заказов показывает вычисленные поля и действия в конце", async ({ page }) => {
    await page.goto("/map-orders");

    await page.getByRole("button", { name: "Добавить заказ" }).click();

    const headerFields = await page
      .locator('[role="columnheader"][data-field]')
      .evaluateAll<string>((nodes) =>
        nodes.map((node) => node.getAttribute("data-field") ?? ""),
      );

    expect(headerFields[0]).toBe("seq");
    expect(headerFields[1]).toBe("id");
    expect(headerFields).toContain("depotDirectMin");
    expect(headerFields).toContain("groupId");
    expect(headerFields).toContain("routePos");
    expect(headerFields).toContain("etaRelMin");
    expect(headerFields).toContain("plannedC2eMin");
    expect(headerFields).toContain("skip");
    expect(headerFields).toContain("cert");
    expect(headerFields.at(-1)).toBe("actions");

    await expect(page.getByRole("columnheader", { name: "ETA, мин" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "C2E, мин" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Депо, мин" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Поз. в группе" })).toBeVisible();

    const deleteButtons = page.getByRole("button", { name: "Удалить" });
    expect(await deleteButtons.count()).toBeGreaterThan(0);
  });
});

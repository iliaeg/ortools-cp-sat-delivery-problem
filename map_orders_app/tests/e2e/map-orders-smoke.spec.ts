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

    const headers = [
      "Группа",
      "Позиция в маршруте",
      "ETA, мин",
      "C2E, мин",
      "Пропуск",
      "Сертификат",
    ];

    for (const header of headers) {
      await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
    }

    const headerFields = await page
      .locator('[role="columnheader"][data-field]')
      .evaluateAll<string>((nodes) =>
        nodes.map((node) => node.getAttribute("data-field") ?? ""),
      );

    expect(headerFields.at(0)).toBe("seq");
    expect(headerFields.at(1)).toBe("routePos");
    expect(headerFields).toContain("groupId");
    expect(headerFields).toContain("routePos");
    expect(headerFields).toContain("etaRelMin");
    expect(headerFields).toContain("plannedC2eMin");
    expect(headerFields).toContain("skip");
    expect(headerFields).toContain("cert");
    expect(headerFields.at(-1)).toBe("actions");
  });
});

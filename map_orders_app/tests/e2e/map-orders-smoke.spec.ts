import { test, expect } from "@playwright/test";

test.describe("map orders smoke", () => {
  test("главная страница загружается", async ({ page }) => {
    await page.goto("/map-orders");
    await expect(page.getByText("Параметры решателя")).toBeVisible();
    await expect(page.getByText("Карта заказов")).toBeVisible();
    await expect(page.getByText("Таблица заказов")).toBeVisible();
  });
});

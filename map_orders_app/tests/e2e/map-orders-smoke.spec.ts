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

    const firstRow = page.getByTestId("orders-row").first();
    await expect(firstRow).toContainText("#: ");
    await expect(firstRow).toContainText("Позиция в маршруте:");
    await expect(firstRow).toContainText("Группа:");
    await expect(firstRow).toContainText("ETA, мин:");
    await expect(firstRow).toContainText("C2E, мин:");
    await expect(firstRow).toContainText("Пропуск:");
    await expect(firstRow).toContainText("Сертификат:");

    const deleteButtons = page.getByRole("button", { name: "Удалить" });
    expect(await deleteButtons.count()).toBeGreaterThan(0);
  });
});

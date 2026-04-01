import type { DeliveryPoint } from "@/shared/types/points";
import { buildMetricsCards, buildPointTooltipContent, isPointReadyNow } from "./mapPresentation";

describe("mapPresentation", () => {
  it("builds CP-SAT cards with courier availability first and ratios for used/total", () => {
    const cards = buildMetricsCards(
      {
        totalOrders: 12,
        assignedOrders: 9,
        totalCouriers: 7,
        assignedCouriers: 5,
        objectiveValue: 259.08,
      },
      JSON.stringify({ courier_available_offset: [35.4, -1.2, 0, 12.6] }),
    );

    expect(cards).toEqual([
      { label: "Прибытие курьеров", value: "-1 • 0 • 13 • 35" },
      { label: "Заказы", value: "9 / 12" },
      { label: "Курьеры", value: "5 / 7" },
      { label: "Целевая функция", value: "259.08" },
      { label: "Сертификаты", value: "0 / 12" },
      { label: "Пропуски", value: "0 / 12" },
    ]);
  });

  it("builds marker tooltip content with all enriched order fields", () => {
    const point: DeliveryPoint = {
      internalId: "p-1",
      id: "o-1",
      kind: "order",
      seq: 1,
      lat: 54.749367,
      lon: 20.457778,
      boxes: 2,
      createdAt: "17:58:58",
      readyAt: "18:30:54",
      orderNumber: "314",
      courierWaitMin: 3,
      currentC2eMin: 29,
      plannedC2eMin: 47,
      cert: 1,
      skip: 1,
    };

    const tooltip = buildPointTooltipContent(point, "18:27:54");

    expect(tooltip.title).toBe("Заказ 314");
    expect(tooltip.coordinates).toBe("54.74937, 20.45778");
    expect(tooltip.lines).toEqual([
      { text: "Коробки: 2" },
      { text: "Создан: 17:58:58" },
      { text: "Готов: 18:30:54" },
      { text: "Остаток ВПЗ: 3 мин", emphasized: true },
      { text: "Время ожидания отправления: 3 мин", emphasized: true },
      { text: "Пропуск", tone: "skip", emphasized: true },
      { text: "Сертификат", tone: "cert", emphasized: true },
      { text: "Текущий C2E: 29 мин", emphasized: true },
      { text: "Плановый C2E: 47 мин", emphasized: true },
    ]);
  });

  it("marks order as ready only when toggle is enabled and order is in ready set", () => {
    const point: DeliveryPoint = {
      internalId: "order-1",
      id: "order-1",
      kind: "order",
      seq: 1,
      lat: 0,
      lon: 0,
      boxes: 1,
      createdAt: "00:00:00",
      readyAt: "00:00:00",
    };

    expect(isPointReadyNow(point, false, new Set(["order-1"]))).toBe(false);
    expect(isPointReadyNow(point, true, new Set(["order-1"]))).toBe(true);
    expect(isPointReadyNow(point, true, new Set(["another"]))).toBe(false);
  });
});

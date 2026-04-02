import type { DeliveryPoint } from "@/shared/types/points";
import {
  buildMetricsCards,
  buildPointTooltipContent,
  buildReadyNowOrderIds,
  isPointReadyNow,
} from "./mapPresentation";

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

  it("does not show shelf time when current time is before ready time", () => {
    const point: DeliveryPoint = {
      internalId: "p-shelf-none",
      id: "o-shelf-none",
      kind: "order",
      seq: 1,
      lat: 0,
      lon: 0,
      boxes: 1,
      createdAt: "17:58:58",
      readyAt: "18:30:54",
      courierWaitMin: 3,
    };

    const tooltip = buildPointTooltipContent(point, "18:27:54");
    expect(tooltip.lines.some((line) => line.text.startsWith("Время на полке:"))).toBe(false);
  });

  it("shows shelf time before departure wait and rounds with Math.round", () => {
    const point: DeliveryPoint = {
      internalId: "p-shelf",
      id: "o-shelf",
      kind: "order",
      seq: 1,
      lat: 0,
      lon: 0,
      boxes: 1,
      createdAt: "17:58:58",
      readyAt: "18:30:30",
      courierWaitMin: 7,
    };

    const tooltip = buildPointTooltipContent(point, "18:33:00");
    const shelfIndex = tooltip.lines.findIndex((line) => line.text === "Время на полке: 3 мин");
    const departWaitIndex = tooltip.lines.findIndex((line) =>
      line.text === "Время ожидания отправления: 7 мин");

    expect(shelfIndex).toBeGreaterThanOrEqual(0);
    expect(departWaitIndex).toBeGreaterThanOrEqual(0);
    expect(shelfIndex).toBeLessThan(departWaitIndex);
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

  it("builds ready-now set from solver offsets when they are available", () => {
    const points: DeliveryPoint[] = [
      {
        internalId: "o1",
        id: "o1",
        kind: "order",
        seq: 1,
        lat: 0,
        lon: 0,
        boxes: 1,
        createdAt: "00:00:00",
        readyAt: "23:59:59",
      },
      {
        internalId: "o2",
        id: "o2",
        kind: "order",
        seq: 2,
        lat: 0,
        lon: 0,
        boxes: 1,
        createdAt: "00:00:00",
        readyAt: "23:59:59",
      },
    ];

    const readyIds = buildReadyNowOrderIds({
      showReadyNowOrders: true,
      points,
      baseTimestampMs: Date.parse("2026-04-01T18:50:11.692Z"),
      solverOrderInternalIds: ["o1", "o2"],
      solverOrderReadyOffset: [-2, 10],
    });

    expect([...readyIds]).toEqual(["o1"]);
  });

  it("falls back to readyAt when solver ids do not match map points", () => {
    const points: DeliveryPoint[] = [
      {
        internalId: "real-order",
        id: "real-order",
        kind: "order",
        seq: 1,
        lat: 0,
        lon: 0,
        boxes: 1,
        createdAt: "00:00:00",
        readyAt: "18:49:00",
      },
    ];

    const readyIds = buildReadyNowOrderIds({
      showReadyNowOrders: true,
      points,
      baseTimestampMs: Date.parse("2026-04-01T18:50:11.692Z"),
      solverOrderInternalIds: ["foreign-id"],
      solverOrderReadyOffset: [-100],
    });

    expect(readyIds.has("real-order")).toBe(true);
  });

  it("falls back to readyAt time and treats already-ready orders as ready now", () => {
    const points: DeliveryPoint[] = [
      {
        internalId: "past",
        id: "past",
        kind: "order",
        seq: 1,
        lat: 0,
        lon: 0,
        boxes: 1,
        createdAt: "00:00:00",
        readyAt: "18:49:00",
      },
      {
        internalId: "future",
        id: "future",
        kind: "order",
        seq: 2,
        lat: 0,
        lon: 0,
        boxes: 1,
        createdAt: "00:00:00",
        readyAt: "18:55:00",
      },
    ];

    const readyIds = buildReadyNowOrderIds({
      showReadyNowOrders: true,
      points,
      baseTimestampMs: Date.parse("2026-04-01T18:50:11.692Z"),
    });

    expect(readyIds.has("past")).toBe(true);
    expect(readyIds.has("future")).toBe(false);
  });

  it("handles midnight boundary in readyAt fallback", () => {
    const points: DeliveryPoint[] = [
      {
        internalId: "midnight-ready",
        id: "midnight-ready",
        kind: "order",
        seq: 1,
        lat: 0,
        lon: 0,
        boxes: 1,
        createdAt: "00:00:00",
        readyAt: "23:58:00",
      },
    ];

    const readyIds = buildReadyNowOrderIds({
      showReadyNowOrders: true,
      points,
      baseTimestampMs: Date.parse("2026-04-02T00:05:00.000Z"),
    });

    expect(readyIds.has("midnight-ready")).toBe(true);
  });
});

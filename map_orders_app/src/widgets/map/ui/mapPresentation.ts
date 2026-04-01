import type { DeliveryPoint } from "@/shared/types/points";
import type { SolverMetricsSummary } from "@/shared/types/solver";

export interface MetricCard {
  label: string;
  value: string;
}

export interface TooltipLine {
  text: string;
  emphasized?: boolean;
  tone?: "skip" | "cert";
}

export interface PointTooltipContent {
  title: string;
  coordinates: string;
  lines: TooltipLine[];
}

const parseTimeToMinutes = (time: string | undefined): number | null => {
  if (!time || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const [hh, mm, ss] = time.split(":").map((value) => Number.parseInt(value, 10) || 0);
  return hh * 60 + mm + ss / 60;
};

const getPreparationWaitMinutes = (point: DeliveryPoint, currentTime?: string): number | null => {
  const readyMinutes = parseTimeToMinutes(point.readyAt);
  const currentMinutes = parseTimeToMinutes(currentTime);
  if (readyMinutes === null || currentMinutes === null) {
    return null;
  }
  const diff = readyMinutes - currentMinutes;
  if (!Number.isFinite(diff) || diff < 0) {
    return null;
  }
  return diff;
};

export const formatPointLabel = (point: DeliveryPoint): string => {
  if (point.kind === "depot") {
    return "Депо";
  }
  const numberLabel =
    point.orderNumber !== undefined && point.orderNumber !== null
      ? String(point.orderNumber)
      : point.id || point.internalId.slice(0, 6);
  return `Заказ ${numberLabel}`;
};

export const buildPointTooltipContent = (
  point: DeliveryPoint,
  currentTime?: string,
): PointTooltipContent => {
  const lines: TooltipLine[] = [];

  if (point.kind === "order") {
    lines.push({ text: `Коробки: ${point.boxes}` });
    lines.push({ text: `Создан: ${point.createdAt}` });
    lines.push({ text: `Готов: ${point.readyAt}` });

    const prepWaitMin = getPreparationWaitMinutes(point, currentTime);
    if (typeof prepWaitMin === "number") {
      lines.push({
        text: `Остаток ВПЗ: ${Math.round(prepWaitMin)} мин`,
        emphasized: true,
      });
    }

    if (typeof point.courierWaitMin === "number") {
      lines.push({
        text: `Время ожидания отправления: ${Math.round(point.courierWaitMin)} мин`,
        emphasized: true,
      });
    }
  }

  if (typeof point.skip === "number" && point.skip > 0) {
    lines.push({ text: "Пропуск", tone: "skip", emphasized: true });
  }

  if (typeof point.cert === "number" && point.cert > 0) {
    lines.push({ text: "Сертификат", tone: "cert", emphasized: true });
  }

  if (typeof point.currentC2eMin === "number") {
    lines.push({
      text: `Текущий C2E: ${Math.round(point.currentC2eMin)} мин`,
      emphasized: true,
    });
  }

  if (typeof point.plannedC2eMin === "number") {
    lines.push({
      text: `Плановый C2E: ${Math.round(point.plannedC2eMin)} мин`,
      emphasized: true,
    });
  }

  return {
    title: formatPointLabel(point),
    coordinates: `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`,
    lines,
  };
};

export const isPointReadyNow = (
  point: DeliveryPoint,
  showReadyNowOrders: boolean,
  readyNowOrderIds: Set<string>,
): boolean => (
  point.kind === "order" && showReadyNowOrders && readyNowOrderIds.has(point.internalId)
);

export const buildMetricsCards = (
  cpSatMetrics: SolverMetricsSummary | null | undefined,
  couriersText: string | undefined,
): MetricCard[] => {
  if (!cpSatMetrics) {
    return [];
  }

  const items: MetricCard[] = [];
  const {
    totalOrders,
    assignedOrders,
    totalCouriers,
    assignedCouriers,
    objectiveValue,
    certCount,
    skipCount,
  } = cpSatMetrics;

  const courierWaitValues: number[] = [];
  if (typeof couriersText === "string" && couriersText.trim().length > 0) {
    try {
      const parsed = JSON.parse(couriersText) as { courier_available_offset?: unknown };
      const offsets = parsed.courier_available_offset;
      if (Array.isArray(offsets)) {
        offsets.forEach((value) => {
          if (typeof value === "number" && Number.isFinite(value)) {
            courierWaitValues.push(value);
          }
        });
      }
    } catch {
      // ignore parse errors
    }
  }
  courierWaitValues.sort((a, b) => a - b);
  const courierWaitRounded: number[] = courierWaitValues.map((value) => Math.round(value));

  const formatRatio = (
    count: number | undefined,
    total: number | undefined,
  ): string => {
    if (total !== undefined) {
      return `${count ?? 0} / ${total}`;
    }
    if (count !== undefined) {
      return String(count);
    }
    return "-";
  };

  if (totalOrders !== undefined || assignedOrders !== undefined) {
    items.push({ label: "Заказы", value: formatRatio(assignedOrders, totalOrders) });
  }
  if (totalCouriers !== undefined || assignedCouriers !== undefined) {
    items.push({ label: "Курьеры", value: formatRatio(assignedCouriers, totalCouriers) });
    if (courierWaitRounded.length > 0) {
      items.push({
        label: "Прибытие курьеров",
        value: courierWaitRounded.join(" • "),
      });
    }
  }
  if (objectiveValue !== undefined) {
    items.push({ label: "Целевая функция", value: String(objectiveValue) });
  }
  if (certCount !== undefined || totalOrders !== undefined) {
    items.push({ label: "Сертификаты", value: formatRatio(certCount, totalOrders) });
  }
  if (skipCount !== undefined || totalOrders !== undefined) {
    items.push({ label: "Пропуски", value: formatRatio(skipCount, totalOrders) });
  }

  const arrivalIndex = items.findIndex((item) => item.label === "Прибытие курьеров");
  if (arrivalIndex > 0) {
    const [arrival] = items.splice(arrivalIndex, 1);
    items.unshift(arrival);
  }

  return items;
};

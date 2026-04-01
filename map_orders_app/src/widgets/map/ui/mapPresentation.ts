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

export interface TooltipLineParts {
  label: string;
  value: string | null;
}

interface BuildReadyNowOrderIdsParams {
  showReadyNowOrders: boolean;
  points: DeliveryPoint[];
  baseTimestampMs?: number | null;
  solverOrderInternalIds?: string[] | null;
  solverOrderReadyOffset?: number[] | null;
  toleranceMs?: number;
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

const parseUtcTimeParts = (time: string): [number, number, number] | null => {
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const [hh, mm, ss] = time.split(":").map((value) => Number.parseInt(value, 10) || 0);
  return [hh, mm, ss];
};

const alignTimeToClosestDay = (baseTimestampMs: number, hh: number, mm: number, ss: number): number => {
  const dayMs = 24 * 60 * 60 * 1000;
  const halfDayMs = dayMs / 2;
  const aligned = new Date(baseTimestampMs);
  aligned.setUTCHours(hh, mm, ss, 0);
  let alignedMs = aligned.getTime();
  const diff = alignedMs - baseTimestampMs;
  if (diff > halfDayMs) {
    alignedMs -= dayMs;
  } else if (diff < -halfDayMs) {
    alignedMs += dayMs;
  }
  return alignedMs;
};

export const buildReadyNowOrderIds = ({
  showReadyNowOrders,
  points,
  baseTimestampMs,
  solverOrderInternalIds,
  solverOrderReadyOffset,
  toleranceMs = 15_000,
}: BuildReadyNowOrderIdsParams): Set<string> => {
  if (!showReadyNowOrders) {
    return new Set<string>();
  }

  const ids = Array.isArray(solverOrderInternalIds) ? solverOrderInternalIds : [];
  const offsets = Array.isArray(solverOrderReadyOffset) ? solverOrderReadyOffset : [];
  if (ids.length > 0 && offsets.length > 0) {
    const result = new Set<string>();
    const pointIdSet = new Set(
      points
        .filter((point) => point.kind === "order")
        .map((point) => point.internalId),
    );
    let matchedPointIds = 0;
    const limit = Math.min(ids.length, offsets.length);
    for (let index = 0; index < limit; index += 1) {
      const internalId = ids[index];
      const offset = offsets[index];
      if (
        typeof internalId === "string"
        && internalId.trim().length > 0
        && pointIdSet.has(internalId)
      ) {
        matchedPointIds += 1;
      }
      if (
        typeof internalId === "string"
        && internalId.trim().length > 0
        && pointIdSet.has(internalId)
        && typeof offset === "number"
        && Number.isFinite(offset)
        && offset <= 0
      ) {
        result.add(internalId);
      }
    }
    if (matchedPointIds > 0) {
      return result;
    }
  }

  if (typeof baseTimestampMs !== "number" || Number.isNaN(baseTimestampMs)) {
    return new Set<string>();
  }

  const result = new Set<string>();
  points.forEach((point) => {
    if (point.kind !== "order" || !point.readyAt) {
      return;
    }
    const parts = parseUtcTimeParts(point.readyAt);
    if (!parts) {
      return;
    }
    const [hh, mm, ss] = parts;
    const readyTimestamp = alignTimeToClosestDay(baseTimestampMs, hh, mm, ss);
    if (!Number.isNaN(readyTimestamp) && readyTimestamp <= baseTimestampMs + toleranceMs) {
      result.add(point.internalId);
    }
  });
  return result;
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

export const splitTooltipLineText = (text: string): TooltipLineParts => {
  const separatorIndex = text.indexOf(":");
  if (separatorIndex <= 0) {
    return {
      label: text.trim(),
      value: null,
    };
  }

  const label = text.slice(0, separatorIndex).trim();
  const value = text.slice(separatorIndex + 1).trim();
  return {
    label,
    value: value.length > 0 ? value : null,
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

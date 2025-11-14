import { v4 as uuidv4 } from "uuid";
import { getStableColorFromSeed } from "@/shared/lib/color";
import { stringifyWithInlineArrays } from "@/shared/lib/json";
import type {
  DeliveryPoint,
  MapOrdersPersistedState,
  MapRouteSegment,
} from "@/shared/types/points";
import type {
  OrdersComputedPatch,
  SolverDomainResponse,
  SolverSolveResponse,
} from "@/shared/types/solver";

export class CpSatLogParseError extends Error {}

type UnknownRecord = Record<string, unknown>;

interface CombinedOrderEntry {
  originalIndex: number;
  orderId: string;
  request: UnknownRecord;
  response?: UnknownRecord;
  orderNumber?: string | number;
  coordinates?: { lat: number; lon: number } | null;
  createdAtUtc?: Date | null;
  readyAtUtc?: Date | null;
  point?: DeliveryPoint;
}

interface CombinedCourierEntry {
  courierId: string;
  request?: UnknownRecord;
  response?: UnknownRecord;
}

const ensureObject = (value: unknown, errorMessage: string): UnknownRecord => {
  if (typeof value === "object" && value !== null) {
    return value as UnknownRecord;
  }
  throw new CpSatLogParseError(errorMessage);
};

const stripBom = (value: string): string =>
  value.startsWith("\uFEFF") ? value.slice(1) : value;

const findJsonBlockAfterKey = (source: string, key: string): string | null => {
  const pattern = new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*:`, "i");
  const match = pattern.exec(source);
  if (!match) {
    return null;
  }
  const afterKeyIndex = match.index + match[0].length;
  let index = afterKeyIndex;
  while (index < source.length && /\s|\r|\n/.test(source[index])) {
    index += 1;
  }
  if (source[index] !== "{") {
    return null;
  }
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(index, cursor + 1);
      }
    }
  }
  return null;
};

export const parseCpSatLogPayload = (rawText: string): unknown => {
  const cleaned = stripBom(rawText).trim();
  if (!cleaned) {
    throw new CpSatLogParseError("Буфер обмена пуст");
  }
  try {
    return JSON.parse(cleaned);
  } catch (primaryError) {
    const enrichedBlock = findJsonBlockAfterKey(cleaned, '"EnrichedPayload"');
    if (enrichedBlock) {
      try {
        const enriched = JSON.parse(enrichedBlock);
        return { EnrichedPayload: enriched };
      } catch (nestedError) {
        throw primaryError;
      }
    }
    throw primaryError;
  }
};

const pickProperty = (
  record: UnknownRecord | null | undefined,
  ...candidates: string[]
): unknown => {
  if (!record) {
    return undefined;
  }
  for (const candidate of candidates) {
    if (candidate in record) {
      return record[candidate];
    }
    const lower = candidate.toLowerCase();
    const foundKey = Object.keys(record).find((key) => key.toLowerCase() === lower);
    if (foundKey) {
      return record[foundKey];
    }
  }
  return undefined;
};

const asArray = <T = unknown>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const toStringId = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const toBooleanFlag = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return ["true", "1", "yes"].includes(normalized);
  }
  return false;
};

const parseDate = (value: unknown): Date | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalised = value.trim();
  if (!normalised) {
    return null;
  }
  const withUtc = normalised.endsWith("Z") || normalised.includes("+")
    ? normalised
    : `${normalised}Z`;
  const date = new Date(withUtc);
  return Number.isNaN(date.getTime()) ? null : date;
};

const minutesBetween = (
  reference: Date | null,
  target: Date | null,
): number | undefined => {
  if (!reference || !target) {
    return undefined;
  }
  const deltaMs = target.getTime() - reference.getTime();
  return Math.round(deltaMs / 60000);
};

const formatTimePart = (value: Date | null): string => {
  if (!value) {
    return "00:00:00";
  }
  return value.toISOString().slice(11, 19);
};

const extractTimeString = (value: unknown): string => {
  if (typeof value === "string" && /^\d{2}:\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  return formatTimePart(parseDate(value));
};

const pickCoordinates = (record: UnknownRecord): { lat: number; lon: number } | null => {
  const directLat = toFiniteNumber(pickProperty(record, "lat", "latitude", "Lat", "Latitude"));
  const directLon = toFiniteNumber(pickProperty(record, "lon", "longitude", "Lon", "Longitude"));
  if (directLat !== undefined && directLon !== undefined) {
    return { lat: directLat, lon: directLon };
  }

  const coordinates = pickProperty(record, "coordinates", "Coordinates");
  if (typeof coordinates === "object" && coordinates !== null) {
    const lat = toFiniteNumber(
      pickProperty(coordinates as UnknownRecord, "lat", "latitude", "Lat", "Latitude"),
    );
    const lon = toFiniteNumber(
      pickProperty(coordinates as UnknownRecord, "lon", "longitude", "Lon", "Longitude"),
    );
    if (lat !== undefined && lon !== undefined) {
      return { lat, lon };
    }
  }

  const location = pickProperty(record, "location", "Location");
  if (typeof location === "object" && location !== null) {
    const lat = toFiniteNumber(
      pickProperty(location as UnknownRecord, "lat", "latitude", "Lat", "Latitude"),
    );
    const lon = toFiniteNumber(
      pickProperty(location as UnknownRecord, "lon", "longitude", "Lon", "Longitude"),
    );
    if (lat !== undefined && lon !== undefined) {
      return { lat, lon };
    }
  }

  const latitude = toFiniteNumber(pickProperty(record, "latitude", "Latitude"));
  const longitude = toFiniteNumber(pickProperty(record, "longitude", "Longitude"));
  if (latitude !== undefined && longitude !== undefined) {
    return { lat: latitude, lon: longitude };
  }

  return null;
};

const extractOrderNumber = (candidate: unknown): string | number | undefined => {
  if (candidate === null || candidate === undefined) {
    return undefined;
  }
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    return trimmed.length ? trimmed : undefined;
  }
  return undefined;
};

const compareOrderEntries = (a: CombinedOrderEntry, b: CombinedOrderEntry): number => {
  const getNumeric = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return undefined;
  };

  const aNumeric = getNumeric(a.orderNumber);
  const bNumeric = getNumeric(b.orderNumber);
  if (aNumeric !== undefined && bNumeric !== undefined) {
    if (aNumeric !== bNumeric) {
      return aNumeric - bNumeric;
    }
  } else if (aNumeric !== undefined) {
    return -1;
  } else if (bNumeric !== undefined) {
    return 1;
  }

  const aLabel = a.orderNumber !== undefined ? String(a.orderNumber) : a.orderId;
  const bLabel = b.orderNumber !== undefined ? String(b.orderNumber) : b.orderId;
  return aLabel.localeCompare(bLabel, undefined, { numeric: true, sensitivity: "base" });
};

export const buildStateFromCpSatLog = (
  payload: unknown,
): Partial<MapOrdersPersistedState> => {
  const root = ensureObject(payload, "Некорректный формат лога CP-SAT");

  const enriched = root.EnrichedPayload as UnknownRecord | undefined;
  const container = enriched ?? root;

  const request = ensureObject(
    container.Request,
    "Request отсутствует в логе CP-SAT",
  );
  const response = ensureObject(
    container.Response,
    "Response отсутствует в логе CP-SAT",
  );

  const requestOrdersRaw = asArray<UnknownRecord>(
    pickProperty(request, "orders", "Orders"),
  );
  const responseOrdersRaw = asArray<UnknownRecord>(
    pickProperty(response, "orders", "Orders"),
  );
  const requestCouriersRaw = asArray<UnknownRecord>(
    pickProperty(request, "couriers", "Couriers"),
  );
  const responseCouriersRaw = asArray<UnknownRecord>(
    pickProperty(response, "couriers", "Couriers"),
  );
  const metricsRaw = pickProperty(response, "metrics", "Metrics");
  const metrics =
    typeof metricsRaw === "object" && metricsRaw !== null
      ? {
          totalOrders: toFiniteNumber(
            pickProperty(metricsRaw as UnknownRecord, "total_orders", "TotalOrders"),
          ),
          assignedOrders: toFiniteNumber(
            pickProperty(metricsRaw as UnknownRecord, "assigned_orders", "AssignedOrders"),
          ),
          totalCouriers: toFiniteNumber(
            pickProperty(metricsRaw as UnknownRecord, "total_couriers", "TotalCouriers"),
          ),
          assignedCouriers: toFiniteNumber(
            pickProperty(metricsRaw as UnknownRecord, "assigned_couriers", "AssignedCouriers"),
          ),
          objectiveValue: toFiniteNumber(
            pickProperty(metricsRaw as UnknownRecord, "objective_value", "ObjectiveValue"),
          ),
          certCount: toFiniteNumber(
            pickProperty(metricsRaw as UnknownRecord, "cert_orders", "CertOrders"),
          ),
          skipCount: toFiniteNumber(
            pickProperty(metricsRaw as UnknownRecord, "skip_orders", "SkippedOrders", "Skipped"),
          ),
        }
      : null;

  if (metrics) {
    const computedCerts = responseOrdersRaw.reduce((acc, order) => {
      const isCert = toBooleanFlag(pickProperty(order, "is_cert", "IsCert"));
      return acc + (isCert ? 1 : 0);
    }, 0);
    const computedSkips = responseOrdersRaw.reduce((acc, order) => {
      const isSkipped = toBooleanFlag(pickProperty(order, "is_skipped", "IsSkipped"));
      return acc + (isSkipped ? 1 : 0);
    }, 0);
    if (metrics.certCount === undefined) {
      metrics.certCount = computedCerts;
    }
    if (metrics.skipCount === undefined) {
      metrics.skipCount = computedSkips;
    }
  }

  if (requestOrdersRaw.length === 0) {
    throw new CpSatLogParseError("Request.orders пуст");
  }

  const currentTimestamp = parseDate(
    pickProperty(request, "current_timestamp_utc", "CurrentTimestampUtc"),
  );

  const responseOrdersById = new Map<string, UnknownRecord>();
  responseOrdersRaw.forEach((order) => {
    const orderId = toStringId(
      pickProperty(order, "order_id", "id", "orderId", "OrderId"),
    );
    if (orderId) {
      responseOrdersById.set(orderId, order);
    }
  });

  const combinedOrders: CombinedOrderEntry[] = requestOrdersRaw.map((order, index) => {
    const orderId = toStringId(
      pickProperty(order, "order_id", "id", "orderId", "OrderId"),
    );
    if (!orderId) {
      throw new CpSatLogParseError(`order_id отсутствует для записи заказа №${index + 1}`);
    }

    const responseOrder = responseOrdersById.get(orderId);
    const enrichedNumber = extractOrderNumber(
      pickProperty(order, "number", "Number") ?? pickProperty(responseOrder, "number", "Number"),
    );
    const coordinates = pickCoordinates(order);
    const createdAtUtc = parseDate(
      pickProperty(order, "created_at_utc", "CreatedAtUtc"),
    );
    const readyAtUtc = parseDate(
      pickProperty(order, "expected_ready_at_utc", "ExpectedReadyAtUtc"),
    );

    return {
      originalIndex: index,
      orderId,
      request: order,
      response: responseOrder,
      orderNumber: enrichedNumber,
      coordinates,
      createdAtUtc,
      readyAtUtc,
    };
  });

  const combinedOrderById = new Map<string, CombinedOrderEntry>();
  combinedOrders.forEach((entry) => {
    combinedOrderById.set(entry.orderId, entry);
  });

  const combinedCouriers: CombinedCourierEntry[] = [];
  const requestCouriersById = new Map<string, UnknownRecord>();
  requestCouriersRaw.forEach((courier) => {
    const courierId = toStringId(
      pickProperty(courier, "courier_id", "id", "courierId", "CourierId"),
    );
    if (!courierId) {
      return;
    }
    requestCouriersById.set(courierId, courier);
  });

  const seenCouriers = new Set<string>();
  responseCouriersRaw.forEach((courier) => {
    const courierId = toStringId(
      pickProperty(courier, "courier_id", "id", "courierId", "CourierId"),
    );
    if (!courierId || seenCouriers.has(courierId)) {
      return;
    }
    combinedCouriers.push({
      courierId,
      request: requestCouriersById.get(courierId),
      response: courier,
    });
    seenCouriers.add(courierId);
  });

  requestCouriersRaw.forEach((courier) => {
    const courierId = toStringId(
      pickProperty(courier, "courier_id", "id", "courierId", "CourierId"),
    );
    if (!courierId || seenCouriers.has(courierId)) {
      return;
    }
    combinedCouriers.push({ courierId, request: courier });
    seenCouriers.add(courierId);
  });

  const orderIndexById = new Map<string, number>();
  combinedOrders.forEach((entry) => {
    orderIndexById.set(entry.orderId, entry.originalIndex + 1);
  });

  const sortedOrders = [...combinedOrders].sort(compareOrderEntries);

  const orderPoints: DeliveryPoint[] = sortedOrders.map((entry, index) => {
    const { request: requestOrder } = entry;
    const boxes =
      toFiniteNumber(
        pickProperty(
          requestOrder,
          "boxes_count",
          "BoxesCount",
          "boxes",
          "Boxes",
        ),
      ) ?? 0;
    const coords = entry.coordinates ?? { lat: 0, lon: 0 };
    const createdAtCandidate = pickProperty(
      requestOrder,
      "created_at_utc",
      "CreatedAtUtc",
      "createdAtUtc",
    );
    const readyAtCandidate = pickProperty(
      requestOrder,
      "expected_ready_at_utc",
      "ExpectedReadyAtUtc",
      "readyAtUtc",
    );

    const point: DeliveryPoint = {
      internalId: uuidv4(),
      id: toStringId(requestOrder.order_id ?? requestOrder.id ?? requestOrder.OrderId) ?? `order_${index + 1}`,
      kind: "order",
      seq: index + 1,
      lat: coords.lat,
      lon: coords.lon,
      boxes,
      createdAt: extractTimeString(createdAtCandidate),
      readyAt: extractTimeString(readyAtCandidate),
      orderNumber: entry.orderNumber,
    };

    entry.point = point;
    return point;
  });

  const pointsByOrderId = new Map<string, DeliveryPoint>();
  sortedOrders.forEach((entry) => {
    if (entry.point) {
      pointsByOrderId.set(entry.orderId, entry.point);
    }
  });

  const travelMatrixRaw = asArray(pickProperty(request, "travel_time_matrix_minutes", "TravelTimeMatrixMinutes"));
  const travelMatrix = travelMatrixRaw.map((row) =>
    asArray(row).map((cell) => toFiniteNumber(cell) ?? 0),
  );

  const etaVector: Record<number, number> = {};
  const skipVector: Record<number, number> = {};
  const certVector: Record<number, number> = {};
  const assignedToCourier: Record<string, number> = {};
  const computedPatches: OrdersComputedPatch[] = [];
  const touchedInternalIds = new Set<string>();
  const routeSegments: MapRouteSegment[] = [];
  const solverRoutes: number[][] = [];

  const depotSource =
    pickProperty(request, "depot", "Depot", "pizzeria", "Pizzeria") ??
    pickProperty(container, "UnitCoordinates", "unitCoordinates");
  const depotCoordinates =
    typeof depotSource === "object" && depotSource !== null
      ? pickCoordinates(depotSource as UnknownRecord)
      : null;

  const depotPoint: DeliveryPoint = {
    internalId: uuidv4(),
    id:
      toStringId(
        pickProperty(container, "UnitId", "unitId", "depot_id", "DepotId"),
      ) ?? "depot",
    kind: "depot",
    seq: 0,
    lat: depotCoordinates?.lat ?? orderPoints[0]?.lat ?? 0,
    lon: depotCoordinates?.lon ?? orderPoints[0]?.lon ?? 0,
    boxes: 0,
    createdAt: formatTimePart(currentTimestamp),
    readyAt: formatTimePart(currentTimestamp),
  };

  const points: DeliveryPoint[] = [depotPoint, ...orderPoints];

  combinedCouriers.forEach((courierEntry, groupId) => {
    const { response: responseCourier } = courierEntry;
    const deliverySequence = asArray<UnknownRecord>(
      pickProperty(responseCourier, "delivery_sequence", "DeliverySequence"),
    );

    const plannedDepartureDate = parseDate(
      pickProperty(responseCourier, "planned_departure_at_utc", "PlannedDepartureAtUtc"),
    );
    const plannedDepartureRelMin = minutesBetween(currentTimestamp, plannedDepartureDate);
    const plannedDepartureIso = plannedDepartureDate?.toISOString();

    const routeNodes: number[] = [0];
    const routePoints: Array<{ point: DeliveryPoint; routePos: number }>
      = [];

    deliverySequence.forEach((stop, index) => {
      const orderId = toStringId(
        pickProperty(stop, "order_id", "id", "orderId", "OrderId"),
      );
      if (!orderId) {
        return;
      }
      const point = pointsByOrderId.get(orderId);
      const orderIndex = orderIndexById.get(orderId);
      if (!point || !orderIndex) {
        return;
      }

      const routePos =
        toFiniteNumber(pickProperty(stop, "position", "Position")) ?? index + 1;
      routeNodes.push(orderIndex);

      const responseOrder = responseOrdersById.get(orderId);
      const combinedOrder = combinedOrderById.get(orderId);
      const requestOrderRaw = combinedOrder?.request;
      const etaRelMin = minutesBetween(
        currentTimestamp,
        parseDate(
          pickProperty(
            responseOrder,
            "planned_delivery_at_utc",
            "PlannedDeliveryAtUtc",
          ),
        ),
      );
      const createdAtUtc =
        combinedOrder?.createdAtUtc
          ?? parseDate(pickProperty(requestOrderRaw, "created_at_utc", "CreatedAtUtc"));
      const plannedC2eMin = minutesBetween(
        createdAtUtc,
        parseDate(
          pickProperty(responseOrder, "planned_delivery_at_utc", "PlannedDeliveryAtUtc"),
        ),
      );
      const currentC2eMin = minutesBetween(createdAtUtc, currentTimestamp);
      const skip = toBooleanFlag(pickProperty(responseOrder, "is_skipped", "IsSkipped")) ? 1 : 0;
      const cert = toBooleanFlag(pickProperty(responseOrder, "is_cert", "IsCert")) ? 1 : 0;

      const depotDirectMin = (() => {
        const matrixRow = travelMatrix?.[0];
        if (!matrixRow) {
          return undefined;
        }
        const originalIndex = combinedOrder?.originalIndex;
        if (originalIndex === undefined) {
          return undefined;
        }
        const travelValue = matrixRow[originalIndex + 1];
        return typeof travelValue === "number" && Number.isFinite(travelValue)
          ? travelValue
          : undefined;
      })();

      const patch: OrdersComputedPatch = {
        internalId: point.internalId,
        groupId,
        routePos,
        etaRelMin,
        plannedC2eMin,
        currentC2eMin,
        courierWaitMin: plannedDepartureRelMin,
        skip,
        cert,
        depotDirectMin,
      };
      computedPatches.push(patch);
      touchedInternalIds.add(point.internalId);

      if (etaRelMin !== undefined) {
        etaVector[orderIndex] = etaRelMin;
      }
      if (skip) {
        skipVector[orderIndex] = skip;
      }
      if (cert) {
        certVector[orderIndex] = cert;
      }

      assignedToCourier[String(orderIndex)] = groupId;

      point.groupId = groupId;
      point.routePos = routePos;
      point.etaRelMin = etaRelMin;
      point.plannedC2eMin = plannedC2eMin;
      point.currentC2eMin = currentC2eMin;
      point.courierWaitMin = plannedDepartureRelMin ?? undefined;
      point.skip = skip || undefined;
      point.cert = cert || undefined;
      point.depotDirectMin = depotDirectMin;

      routePoints.push({ point, routePos });
    });

    routeNodes.push(0);
    solverRoutes.push(routeNodes);

    const validPolyline = routePoints
      .map(({ point }) => [point.lat, point.lon] as [number, number])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));

    if (routePoints.length > 0 && validPolyline.length > 0) {
      const segments: MapRouteSegment["segments"] = [];
      for (let idx = 0; idx < routePoints.length - 1; idx += 1) {
        const current = routePoints[idx];
        const next = routePoints[idx + 1];
        segments.push({
          from: [current.point.lat, current.point.lon],
          to: [next.point.lat, next.point.lon],
          mid: [
            (current.point.lat + next.point.lat) / 2,
            (current.point.lon + next.point.lon) / 2,
          ],
          fromPos: current.routePos,
          toPos: next.routePos,
        });
      }

      let depotSegment: MapRouteSegment["depotSegment"] | undefined;
      if (depotCoordinates && routePoints.length > 0) {
        const first = routePoints[0];
        depotSegment = {
          from: [depotCoordinates.lat, depotCoordinates.lon],
          to: [first.point.lat, first.point.lon],
          mid: [
            (depotCoordinates.lat + first.point.lat) / 2,
            (depotCoordinates.lon + first.point.lon) / 2,
          ],
          fromPos: 0,
          toPos: first.routePos,
        };
      }

      const colorSeedParts = routePoints
        .map(({ point }) => point.id)
        .sort((a, b) => a.localeCompare(b));
      const colorSeed = colorSeedParts.length ? colorSeedParts.join("|") : `route-${groupId}`;
      const color = getStableColorFromSeed(`cp-sat-${colorSeed}`);

      const tooltipOrders = routePoints
        .map(({ point }) => point.orderNumber ?? point.id)
        .join(", ");

      routeSegments.push({
        groupId,
        color,
        polyline: validPolyline,
        depotSegment,
        segments,
        tooltip: `Маршрут ${groupId + 1}: ${tooltipOrders}`,
        plannedDepartureRelMin,
        plannedDepartureIso,
      });
    }
  });

  responseOrdersRaw.forEach((order) => {
    const orderId = toStringId(
      pickProperty(order, "order_id", "id", "orderId", "OrderId"),
    );
    if (!orderId) {
      return;
    }
    const point = pointsByOrderId.get(orderId);
    if (!point) {
      return;
    }
    if (touchedInternalIds.has(point.internalId)) {
      return;
    }

    const orderIndex = orderIndexById.get(orderId);
    const skip = toBooleanFlag(pickProperty(order, "is_skipped", "IsSkipped")) ? 1 : 0;
    const cert = toBooleanFlag(pickProperty(order, "is_cert", "IsCert")) ? 1 : 0;
    const etaRelMin = minutesBetween(
      currentTimestamp,
      parseDate(pickProperty(order, "planned_delivery_at_utc", "PlannedDeliveryAtUtc")),
    );

    const combinedOrder = combinedOrderById.get(orderId);
    const createdAtUtc = combinedOrder?.createdAtUtc ?? null;
    const plannedC2eMin = minutesBetween(
      createdAtUtc,
      parseDate(pickProperty(order, "planned_delivery_at_utc", "PlannedDeliveryAtUtc")),
    );
    const currentC2eMin = minutesBetween(createdAtUtc, currentTimestamp);

    const depotDirectMin = (() => {
      const matrixRow = travelMatrix?.[0];
      if (!matrixRow) {
        return undefined;
      }
      const originalIndex = combinedOrder?.originalIndex;
      if (originalIndex === undefined) {
        return undefined;
      }
      const travelValue = matrixRow[originalIndex + 1];
      return typeof travelValue === "number" && Number.isFinite(travelValue)
        ? travelValue
        : undefined;
    })();

    const patch: OrdersComputedPatch = {
      internalId: point.internalId,
      groupId: undefined,
      routePos: undefined,
      etaRelMin,
      plannedC2eMin,
      currentC2eMin,
      skip,
      cert,
      depotDirectMin,
    };
    computedPatches.push(patch);
    touchedInternalIds.add(point.internalId);

    if (orderIndex && etaRelMin !== undefined) {
      etaVector[orderIndex] = etaRelMin;
    }
    if (orderIndex && skip) {
      skipVector[orderIndex] = skip;
    }
    if (orderIndex && cert) {
      certVector[orderIndex] = cert;
    }

    point.skip = skip || undefined;
    point.cert = cert || undefined;
    point.etaRelMin = etaRelMin;
    point.plannedC2eMin = plannedC2eMin;
    point.currentC2eMin = currentC2eMin;
    point.depotDirectMin = depotDirectMin;
  });

  const solverResult: SolverSolveResponse = {
    result: {
      routes: solverRoutes,
      t_delivery: etaVector,
      skip: skipVector,
      cert: certVector,
      assigned_to_courier: assignedToCourier,
      meta: {
        current_timestamp_utc: currentTimestamp?.toISOString(),
      },
    },
    ordersComputed: computedPatches,
    routesSegments: routeSegments,
    domainResponse: response as SolverDomainResponse,
  };

  const courierCapacity = requestCouriersRaw.map((courier) =>
    toFiniteNumber(pickProperty(courier, "box_capacity", "BoxCapacity", "capacity", "Capacity")) ?? 0,
  );
  const courierAvailable = requestCouriersRaw.map((courier) =>
    minutesBetween(
      currentTimestamp,
      parseDate(
        pickProperty(
          courier,
          "expected_courier_return_at_utc",
          "ExpectedCourierReturnAtUtc",
          "available_at_utc",
          "AvailableAtUtc",
        ),
      ),
    ) ?? 0,
  );

  const optimization = ensureObject(
    (pickProperty(request, "optimization_weights", "OptimizationWeights") as UnknownRecord)
      ?? {},
    "optimization weights",
  );
  const solverSettings = ensureObject(
    (pickProperty(request, "solver_settings", "SolverSettings") as UnknownRecord) ?? {},
    "solver settings",
  );

  const weightsPayload: Record<string, number> = {};
  const certificateWeight = toFiniteNumber(
    pickProperty(
      optimization,
      "certificate_penalty_weight",
      "CertificatePenaltyWeight",
    ),
  );
  if (certificateWeight !== undefined) {
    weightsPayload.W_cert = certificateWeight;
  }
  const c2eWeight = toFiniteNumber(
    pickProperty(
      optimization,
      "click_to_eat_penalty_weight",
      "ClickToEatPenaltyWeight",
    ),
  );
  if (c2eWeight !== undefined) {
    weightsPayload.W_c2e = c2eWeight;
  }
  const skipWeight = toFiniteNumber(
    pickProperty(
      optimization,
      "skip_order_penalty_weight",
      "SkipOrderPenaltyWeight",
    ),
  );
  if (skipWeight !== undefined) {
    weightsPayload.W_skip = skipWeight;
  }

  const idleWeight = toFiniteNumber(
    pickProperty(
      optimization,
      "courier_idle_penalty_weight",
      "CourierIdlePenaltyWeight",
    ),
  );
  if (idleWeight !== undefined) {
    weightsPayload.W_idle = idleWeight;
  }

  const additionalParams: Record<string, number> = {};
  const timeLimit = toFiniteNumber(
    pickProperty(solverSettings, "time_limit_seconds", "TimeLimitSeconds", "time_limit", "TimeLimit"),
  );
  if (timeLimit !== undefined) {
    additionalParams.time_limit = timeLimit;
  }
  const workers = toFiniteNumber(
    pickProperty(
      solverSettings,
      "max_parallel_workers",
      "MaxParallelWorkers",
      "workers",
      "Workers",
    ),
  );
  if (workers !== undefined) {
    additionalParams.workers = workers;
  }

  const manualTauText = travelMatrix.length
    ? stringifyWithInlineArrays(travelMatrix)
    : "";

  const normalizedMetrics = metrics && Object.values(metrics).some((value) => value !== undefined)
    ? metrics
    : null;

  return {
    points,
    t0Time: formatTimePart(currentTimestamp),
    manualTauText,
    useManualTau: travelMatrix.length > 0,
    couriersText: stringifyWithInlineArrays({
      courier_capacity_boxes: courierCapacity,
      courier_available_offset: courierAvailable,
    }),
    weightsText: stringifyWithInlineArrays(weightsPayload),
    additionalParamsText: stringifyWithInlineArrays(additionalParams),
    solverResult,
    solverInput: null,
    cpSatStatus:
      typeof pickProperty(response, "status", "Status") === "string"
        && (pickProperty(response, "status", "Status") as string).trim().length
        ? String(pickProperty(response, "status", "Status"))
        : undefined,
    cpSatMetrics: normalizedMetrics,
  };
};

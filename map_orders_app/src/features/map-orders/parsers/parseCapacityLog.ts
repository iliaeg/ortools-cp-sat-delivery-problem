import type { MapOrdersPersistedState } from "@/shared/types/points";
import {
  buildStateFromCpSatLog,
  CpSatLogParseError,
  parseCpSatLogPayload,
} from "./parseCpSatLog";

type UnknownRecord = Record<string, unknown>;

const ensureObject = (value: unknown, errorMessage: string): UnknownRecord => {
  if (typeof value === "object" && value !== null) {
    return value as UnknownRecord;
  }
  throw new CpSatLogParseError(errorMessage);
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
    return ["true", "1", "yes"].includes(normalized);
  }
  return false;
};

const toRecord = (value: unknown): UnknownRecord =>
  typeof value === "object" && value !== null ? (value as UnknownRecord) : {};

const extractRequestSource = (root: UnknownRecord): UnknownRecord => {
  const enriched = root.EnrichedPayload as UnknownRecord | undefined;
  const container = enriched ?? root;
  const payloadContainer = (root.Payload as UnknownRecord | undefined) ?? null;

  const requestWrapper =
    ((pickProperty(container, "Request", "request")
      ?? pickProperty(root, "Request", "request")
      ?? pickProperty(payloadContainer, "Request", "request")) as UnknownRecord | undefined)
      ?? null;
  const requestSource = ensureObject(
    requestWrapper,
    "Request отсутствует в Capacity Log",
  );
  return requestSource;
};

const extractRequestEnvelope = (requestSource: UnknownRecord): UnknownRecord => {
  const requestDto = pickProperty(requestSource, "RequestDto", "request_dto");
  if (requestDto && typeof requestDto === "object") {
    const inputs = asArray<UnknownRecord>(
      pickProperty(requestDto as UnknownRecord, "inputs", "Inputs"),
    );
    for (const input of inputs) {
      const data = pickProperty(input, "data", "Data");
      if (data && typeof data === "object") {
        return data as UnknownRecord;
      }
    }
  }
  return requestSource;
};

const extractResponseSource = (root: UnknownRecord): UnknownRecord => {
  const enriched = root.EnrichedPayload as UnknownRecord | undefined;
  const container = enriched ?? root;
  const payloadContainer = (root.Payload as UnknownRecord | undefined) ?? null;
  const responseWrapper =
    ((pickProperty(container, "Response", "response")
      ?? pickProperty(root, "Response", "response")
      ?? pickProperty(payloadContainer, "Response", "response")) as UnknownRecord | undefined)
      ?? null;
  const responseSource = ensureObject(
    responseWrapper,
    "Response отсутствует в Capacity Log",
  );
  return responseSource;
};

interface CapacityNodes {
  root: UnknownRecord;
  requestSource: UnknownRecord;
  requestEnvelope: UnknownRecord;
  currentState: UnknownRecord;
  responseSource: UnknownRecord;
  predictions: UnknownRecord;
}

const extractCapacityNodes = (payload: unknown): CapacityNodes => {
  const root = ensureObject(payload, "Некорректный формат Capacity Log");
  const requestSource = extractRequestSource(root);
  const requestEnvelope = extractRequestEnvelope(requestSource);
  const currentStateRaw = pickProperty(requestEnvelope, "current_state", "CurrentState");
  const currentState = ensureObject(
    currentStateRaw,
    "Ожидался Capacity Log в новом формате: RequestDto.inputs[].data.current_state",
  );

  const responseSource = extractResponseSource(root);
  const responseDto = pickProperty(responseSource, "ResponseDto", "response_dto");
  const responseDtoRecord = ensureObject(
    responseDto,
    "Ожидался Capacity Log в новом формате: ResponseDto.predictions",
  );
  const predictionsRaw = pickProperty(responseDtoRecord, "predictions", "Predictions");
  const predictions = ensureObject(
    predictionsRaw,
    "Ожидался Capacity Log в новом формате: ResponseDto.predictions",
  );

  return {
    root,
    requestSource,
    requestEnvelope,
    currentState,
    responseSource,
    predictions,
  };
};

export const parseCapacityLogPayload = (rawText: string): unknown => {
  const parsed = parseCpSatLogPayload(rawText);
  extractCapacityNodes(parsed);
  return parsed;
};

export const buildStateFromCapacityLog = (
  payload: unknown,
): Partial<MapOrdersPersistedState> => {
  const { root, requestSource, requestEnvelope, currentState, responseSource, predictions } =
    extractCapacityNodes(payload);

  const payloadContainer = toRecord(pickProperty(root, "Payload", "payload"));
  const actualUnitAndSettings = pickProperty(
    payloadContainer,
    "ActualUnitAndSettings",
    "actual_unit_and_settings",
  ) ?? pickProperty(root, "ActualUnitAndSettings", "actual_unit_and_settings");
  const actualOrders = pickProperty(
    payloadContainer,
    "ActualOrders",
    "actual_orders",
  ) ?? pickProperty(root, "ActualOrders", "actual_orders");
  const unitId = pickProperty(
    requestSource,
    "UnitId",
    "unitId",
  ) ?? pickProperty(payloadContainer, "UnitId", "unitId")
    ?? pickProperty(root, "UnitId", "unitId");

  const requestOrders = asArray<UnknownRecord>(pickProperty(currentState, "orders", "Orders"));
  const requestCouriers = asArray<UnknownRecord>(pickProperty(currentState, "couriers", "Couriers"));
  const requestTravelMatrix = asArray(pickProperty(
    currentState,
    "travel_time_matrix_minutes",
    "TravelTimeMatrixMinutes",
  ));
  const currentTimeUtc = pickProperty(
    currentState,
    "current_time_utc",
    "CurrentTimeUtc",
    "current_timestamp_utc",
    "CurrentTimestampUtc",
  );

  const normalizedRequestOrders = requestOrders.map((order) => ({
    order_id: pickProperty(order, "order_id", "OrderId", "id", "Id"),
    order_number: pickProperty(order, "order_number", "OrderNumber", "number", "Number"),
    boxes_count: pickProperty(order, "boxes_count", "BoxesCount", "boxes", "Boxes") ?? 0,
    created_at_utc: pickProperty(order, "created_at_utc", "CreatedAtUtc"),
    expected_ready_at_utc: pickProperty(
      order,
      "expected_ready_at_utc",
      "ExpectedReadyAtUtc",
      "ready_at_utc",
      "ReadyAtUtc",
    ),
  }));

  const normalizedRequestCouriers = requestCouriers.map((courier) => ({
    courier_id: pickProperty(courier, "courier_id", "CourierId", "id", "Id"),
    box_capacity: pickProperty(courier, "box_capacity", "BoxCapacity", "capacity", "Capacity") ?? 0,
    expected_courier_return_at_utc: pickProperty(
      courier,
      "expected_courier_return_at_utc",
      "ExpectedCourierReturnAtUtc",
      "available_at_utc",
      "AvailableAtUtc",
    ),
  }));

  const responseOrderPlans = asArray<UnknownRecord>(
    pickProperty(predictions, "order_plans", "OrderPlans", "orders", "Orders"),
  );
  const responseDispatches = asArray<UnknownRecord>(
    pickProperty(predictions, "dispatches", "Dispatches", "couriers", "Couriers"),
  );

  const normalizedResponseOrders = responseOrderPlans.map((plan) => ({
    order_id: pickProperty(plan, "order_id", "OrderId", "id", "Id"),
    order_number: pickProperty(plan, "order_number", "OrderNumber", "number", "Number"),
    assigned_courier_id: pickProperty(
      plan,
      "assigned_courier_id",
      "AssignedCourierId",
      "courier_id",
      "CourierId",
    ),
    planned_delivery_at_utc: pickProperty(
      plan,
      "planned_delivery_at_utc",
      "PlannedDeliveryAtUtc",
    ),
    is_cert: pickProperty(plan, "is_cert", "IsCert", "is_certificate", "IsCertificate"),
    is_skipped: pickProperty(plan, "is_skipped", "IsSkipped"),
  }));

  const normalizedResponseCouriers = responseDispatches.map((dispatch) => ({
    courier_id: pickProperty(dispatch, "courier_id", "CourierId", "id", "Id"),
    planned_departure_at_utc: pickProperty(
      dispatch,
      "planned_departure_at_utc",
      "PlannedDepartureAtUtc",
    ),
    planned_return_at_utc: pickProperty(
      dispatch,
      "planned_return_at_utc",
      "PlannedReturnAtUtc",
    ),
    delivery_sequence: asArray<UnknownRecord>(
      pickProperty(dispatch, "delivery_sequence", "DeliverySequence"),
    ).map((stop, index) => ({
      position: pickProperty(stop, "position", "Position") ?? index + 1,
      order_id: pickProperty(stop, "order_id", "OrderId", "id", "Id"),
      planned_delivery_at_utc: pickProperty(
        stop,
        "planned_delivery_at_utc",
        "PlannedDeliveryAtUtc",
      ),
      planned_c2e_minutes: pickProperty(
        stop,
        "planned_c2e_minutes",
        "PlannedC2EMinutes",
      ),
    })),
  }));

  const certCount = normalizedResponseOrders.reduce((acc, order) => {
    const isCert = toBooleanFlag(pickProperty(order, "is_cert", "IsCert"));
    return acc + (isCert ? 1 : 0);
  }, 0);
  const skipCount = normalizedResponseOrders.reduce((acc, order) => {
    const isSkipped = toBooleanFlag(pickProperty(order, "is_skipped", "IsSkipped"));
    return acc + (isSkipped ? 1 : 0);
  }, 0);
  const assignedOrders = normalizedResponseOrders.reduce((acc, order) => {
    const courierId = pickProperty(order, "assigned_courier_id", "AssignedCourierId");
    const isAssigned = courierId !== null && courierId !== undefined && String(courierId).trim().length > 0;
    const isSkipped = toBooleanFlag(pickProperty(order, "is_skipped", "IsSkipped"));
    return acc + (isAssigned && !isSkipped ? 1 : 0);
  }, 0);
  const assignedCourierSet = new Set<string>();
  normalizedResponseOrders.forEach((order) => {
    const courierId = pickProperty(order, "assigned_courier_id", "AssignedCourierId");
    const isSkipped = toBooleanFlag(pickProperty(order, "is_skipped", "IsSkipped"));
    if (isSkipped || courierId === null || courierId === undefined) {
      return;
    }
    const normalized = String(courierId).trim();
    if (normalized.length > 0) {
      assignedCourierSet.add(normalized);
    }
  });

  const objectives = toRecord(pickProperty(
    toRecord(pickProperty(predictions, "solution_summary", "SolutionSummary")),
    "objectives",
    "Objectives",
  ));
  const objectiveValue =
    toFiniteNumber(pickProperty(objectives, "phase2_objective_value", "Phase2ObjectiveValue"))
    ?? toFiniteNumber(pickProperty(predictions, "objective_value", "ObjectiveValue"));

  const status = pickProperty(predictions, "status", "Status")
    ?? pickProperty(responseSource, "status", "Status");
  const statusText =
    typeof status === "string" && status.trim().length > 0 ? status : undefined;

  const metrics = {
    total_orders: requestOrders.length,
    assigned_orders: assignedOrders,
    total_couriers: requestCouriers.length,
    assigned_couriers: assignedCourierSet.size,
    objective_value: objectiveValue,
    cert_orders: certCount,
    skip_orders: skipCount,
  };

  const requestWeights = toRecord(
    pickProperty(
      requestEnvelope,
      "optimization_weights",
      "OptimizationWeights",
      "policy_context",
      "PolicyContext",
    ),
  );
  const solverSettings = toRecord(
    pickProperty(
      requestEnvelope,
      "solver_settings",
      "SolverSettings",
      "solver_options",
      "SolverOptions",
    ),
  );

  const unitRecord = toRecord(pickProperty(currentState, "unit", "Unit"));
  const unitCoordinates = pickProperty(unitRecord, "coordinates", "Coordinates");

  const normalizedPayload: UnknownRecord = {
    Request: {
      ...requestSource,
      RequestDto: {
        inputs: [
          {
            data: {
              current_timestamp_utc: currentTimeUtc,
              orders: normalizedRequestOrders,
              couriers: normalizedRequestCouriers,
              travel_time_matrix_minutes: requestTravelMatrix,
              optimization_weights: requestWeights,
              solver_settings: solverSettings,
            },
          },
        ],
      },
    },
    Response: {
      ...responseSource,
      status: statusText,
      Response: {
        status: statusText,
        orders: normalizedResponseOrders,
        couriers: normalizedResponseCouriers,
        metrics,
      },
    },
  };

  if (unitCoordinates && typeof unitCoordinates === "object") {
    normalizedPayload.UnitCoordinates = unitCoordinates;
  }
  if (actualUnitAndSettings && typeof actualUnitAndSettings === "object") {
    normalizedPayload.ActualUnitAndSettings = actualUnitAndSettings;
  }
  if (actualOrders && typeof actualOrders === "object") {
    normalizedPayload.ActualOrders = actualOrders;
  }
  if (unitId !== null && unitId !== undefined && String(unitId).trim().length > 0) {
    normalizedPayload.UnitId = String(unitId);
  }

  return buildStateFromCpSatLog(normalizedPayload);
};

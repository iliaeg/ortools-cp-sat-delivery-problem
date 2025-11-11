import { NextResponse } from "next/server";
import { mapSolverResult } from "@/processes/map-orders/lib/solverResultMapper";
import { getServerEnv } from "@/shared/config/env";
import type {
  SolverDomainCourierPlan,
  SolverDomainMetrics,
  SolverDomainOrderPlan,
  SolverDomainResponse,
  SolverInputPayload,
  SolverMetricsSummary,
  SolverResult,
} from "@/shared/types/solver";

const { solverUrl } = getServerEnv();

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const solverInput = payload.solverInput as SolverInputPayload | undefined;
    if (!solverInput) {
      throw new Error("solverInput не передан");
    }

    const response = await fetch(solverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(solverInput.request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Solver вернул ${response.status}: ${text}`);
    }

    const rawResult = await response.json();
    const domainResult = extractDomainResponse(rawResult);
    const solverResultPayload = convertDomainResultToSolverResult(domainResult, solverInput);
    const mapped = mapSolverResult({ solverInput, solverResult: solverResultPayload });
    const providedMetrics = normalizeMetrics(domainResult.metrics);
    const derivedMetrics = deriveMetricsFromDomain(domainResult);
    const metricsSummary = mergeMetrics(providedMetrics, derivedMetrics);

    return NextResponse.json({
      ...mapped,
      cpSatStatus: normalizeStatusLabel(domainResult.status),
      cpSatMetrics: metricsSummary,
      domainResponse: domainResult,
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}

const extractDomainResponse = (payload: unknown): SolverDomainResponse => {
  const unwrapped = unwrapResultEnvelope(payload);
  if (unwrapped && typeof unwrapped === "object" && "result" in unwrapped) {
    const nested = (unwrapped as { result?: SolverDomainResponse }).result;
    if (nested && typeof nested === "object") {
        return normalizeDomainStructure(nested);
    }
  }
  return normalizeDomainStructure(unwrapped);
};

const normalizeDomainStructure = (data: unknown): SolverDomainResponse => {
  if (!data || typeof data !== "object") {
    return {};
  }
  const node = data as SolverDomainResponse & { predictions?: unknown };
  const predictions = node.predictions;
  if (Array.isArray(predictions) && predictions.length > 0) {
    const inner = normalizeDomainStructure(predictions[0]);
    return {
      ...inner,
      status: inner.status ?? node.status,
      current_timestamp_utc: inner.current_timestamp_utc ?? node.current_timestamp_utc,
      metrics: inner.metrics ?? (node.metrics as SolverDomainMetrics | undefined),
    };
  }
  if (predictions && typeof predictions === "object") {
    const inner = normalizeDomainStructure(predictions);
    return {
      ...inner,
      status: inner.status ?? node.status,
      current_timestamp_utc: inner.current_timestamp_utc ?? node.current_timestamp_utc,
      metrics: inner.metrics ?? (node.metrics as SolverDomainMetrics | undefined),
    };
  }
  return node as SolverDomainResponse;
};

const unwrapResultEnvelope = (payload: unknown): unknown => {
  if (payload && typeof payload === "object") {
    if ("outputs" in payload && Array.isArray((payload as Record<string, unknown>).outputs)) {
      const outputs = (payload as { outputs: Array<{ data?: unknown; result?: unknown }> }).outputs;
      const first = outputs[0];
      if (first?.result) {
        return first.result;
      }
      if (first?.data) {
        return first.data;
      }
    }
  }
  return payload;
};

const convertDomainResultToSolverResult = (
  domainResult: SolverDomainResponse,
  solverInput: SolverInputPayload,
): SolverResult => {
  const meta = solverInput.meta;
  const orderIds = meta.orderExternalIds ?? meta.orderInternalIds;
  const orderIndexById = new Map<string, number>();
  orderIds.forEach((orderId, index) => {
    orderIndexById.set(orderId, index + 1);
  });

  const courierIds = meta.courierExternalIds ?? [];
  const courierIndexById = new Map<string, number>();
  courierIds.forEach((courierId, index) => {
    courierIndexById.set(courierId, index);
  });

  const couriers = domainResult.couriers ?? [];
  const courierPlanById = new Map<string, SolverDomainCourierPlan>();
  couriers.forEach((plan) => {
    if (plan?.courier_id) {
      courierPlanById.set(plan.courier_id, plan);
    }
  });

  const expectedCouriers = Math.max(
    courierIds.length,
    couriers.length,
    solverInput.courier_available_offset?.length ?? 0,
  );

  const baseTimeIso = domainResult.current_timestamp_utc ?? meta.T0_iso;
  const baseTime = Number.isFinite(new Date(baseTimeIso).getTime())
    ? new Date(baseTimeIso)
    : new Date(meta.T0_iso);

  const toRelativeMinutes = (iso?: string | null): number | undefined => {
    if (!iso) {
      return undefined;
    }
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return Math.round((parsed.getTime() - baseTime.getTime()) / 60000);
  };

  const routes: number[][] = [];
  const tDeparture: number[] = [];
  for (let index = 0; index < expectedCouriers; index += 1) {
    const courierId = courierIds[index];
    const plan = (courierId ? courierPlanById.get(courierId) : undefined) ?? couriers[index];
    const sequence = plan?.delivery_sequence ?? [];
    const nodes = sequence
      .map((stop) => orderIndexById.get(stop.order_id))
      .filter((node): node is number => typeof node === "number");
    const route = nodes.length ? [0, ...nodes, 0] : [0, 0];
    routes.push(route);
    const departureRel =
      toRelativeMinutes(plan?.planned_departure_at_utc) ?? solverInput.courier_available_offset?.[index] ?? 0;
    tDeparture.push(departureRel);
  }

  const tDelivery: Record<number, number> = {};
  const skipFlags: Record<number, number> = {};
  const certFlags: Record<number, number> = {};
  const assignedToCourier: Record<string, number> = {};

  (domainResult.orders ?? []).forEach((order) => {
    const index = orderIndexById.get(order.order_id);
    if (!index) {
      return;
    }
    const deliveryRel = toRelativeMinutes(order.planned_delivery_at_utc);
    if (deliveryRel !== undefined) {
      tDelivery[index] = deliveryRel;
    }
    if (order.is_skipped) {
      skipFlags[index] = 1;
    }
    if (order.is_cert) {
      certFlags[index] = 1;
    }
    const courierId = order.assigned_courier_id ?? undefined;
    if (courierId) {
      const courierIndex = courierIndexById.get(courierId);
      if (courierIndex !== undefined) {
        assignedToCourier[String(index)] = courierIndex;
      }
    }
  });

  return {
    routes,
    t_departure: tDeparture,
    t_delivery: tDelivery,
    skip: skipFlags,
    cert: certFlags,
    assigned_to_courier: assignedToCourier,
    meta: {
      status: domainResult.status,
      current_timestamp_utc: domainResult.current_timestamp_utc,
      metrics: domainResult.metrics,
    },
  };
};

const normalizeStatusLabel = (status?: string): string | undefined => {
  if (typeof status !== "string") {
    return undefined;
  }
  const trimmed = status.trim();
  return trimmed.length ? trimmed : undefined;
};

const normalizeMetrics = (metrics?: SolverDomainMetrics): SolverMetricsSummary | null => {
  if (!metrics) {
    return null;
  }
  const summary: SolverMetricsSummary = {
    totalOrders: metrics.total_orders,
    assignedOrders: metrics.assigned_orders,
    totalCouriers: metrics.total_couriers,
    assignedCouriers: metrics.assigned_couriers,
    objectiveValue: metrics.objective_value,
    certCount: metrics.cert_count,
    skipCount: metrics.skip_count,
  };
  const hasValue = Object.values(summary).some((value) => value !== undefined && value !== null);
  return hasValue ? summary : null;
};

const deriveMetricsFromDomain = (domainResult: SolverDomainResponse): SolverMetricsSummary | null => {
  const orders = domainResult.orders ?? [];
  const couriers = domainResult.couriers ?? [];
  if (!orders.length && !couriers.length) {
    return null;
  }

  const totalOrders = orders.length || undefined;
  const assignedOrders = orders.filter(
    (order) => !order.is_skipped && typeof order.assigned_courier_id === "string" && order.assigned_courier_id.trim().length,
  ).length || undefined;
  const certCount = orders.filter((order) => order.is_cert).length || undefined;
  const skipCount = orders.filter((order) => order.is_skipped).length || undefined;

  const totalCouriers = couriers.length || undefined;
  const assignedCourierIds = new Set(
    couriers
      .filter((courier) => (courier.delivery_sequence ?? []).length > 0)
      .map((courier) => courier.courier_id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
  );
  const assignedCouriers = assignedCourierIds.size || undefined;

  const summary: SolverMetricsSummary = {
    totalOrders,
    assignedOrders,
    totalCouriers,
    assignedCouriers,
    certCount,
    skipCount,
  };
  const hasValue = Object.values(summary).some((value) => value !== undefined && value !== null);
  return hasValue ? summary : null;
};

const mergeMetrics = (
  primary: SolverMetricsSummary | null,
  fallback: SolverMetricsSummary | null,
): SolverMetricsSummary | null => {
  if (!primary && !fallback) {
    return null;
  }
  return {
    totalOrders: primary?.totalOrders ?? fallback?.totalOrders,
    assignedOrders: primary?.assignedOrders ?? fallback?.assignedOrders,
    totalCouriers: primary?.totalCouriers ?? fallback?.totalCouriers,
    assignedCouriers: primary?.assignedCouriers ?? fallback?.assignedCouriers,
    objectiveValue: primary?.objectiveValue ?? fallback?.objectiveValue,
    certCount: primary?.certCount ?? fallback?.certCount,
    skipCount: primary?.skipCount ?? fallback?.skipCount,
  };
};

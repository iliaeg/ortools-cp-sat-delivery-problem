import { describe, expect, it } from "vitest";

import { mapSolverResult } from "@/processes/map-orders/lib/solverResultMapper";
import { getStableColorFromSeed } from "@/shared/lib/color";
import type { SolverInputPayload, SolverResult } from "@/shared/types/solver";

const buildSolverInput = (): SolverInputPayload => ({
  request: {
    inputs: [
      {
        data: {
          current_timestamp_utc: "2024-01-01T00:00:00Z",
          travel_time_matrix_minutes: [
            [0, 5, 7],
            [5, 0, 3],
            [7, 3, 0],
          ],
          orders: [
            {
              order_id: "order-1",
              boxes_count: 2,
              created_at_utc: "2024-01-01T00:04:00Z",
              expected_ready_at_utc: "2024-01-01T00:10:00Z",
            },
            {
              order_id: "order-2",
              boxes_count: 1,
              created_at_utc: "2024-01-01T00:06:00Z",
              expected_ready_at_utc: "2024-01-01T00:12:00Z",
            },
          ],
          couriers: [
            {
              courier_id: "courier-1",
              box_capacity: 10,
              expected_courier_return_at_utc: "2024-01-01T00:00:00Z",
            },
          ],
          optimization_weights: {
            certificate_penalty_weight: 1_000,
            click_to_eat_penalty_weight: 1,
            skip_order_penalty_weight: 10_000,
          },
        },
      },
    ],
  },
  tau: [
    [0, 5, 7],
    [5, 0, 3],
    [7, 3, 0],
  ],
  order_created_offset: [4, 6],
  order_ready_offset: [10, 12],
  courier_available_offset: [0],
  meta: {
    pointsLatLon: [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    mode: "OSRM",
    osrmBaseUrl: "http://localhost",
    T0_iso: "2024-01-01T00:00:00.000Z",
    pointInternalIds: ["depot", "order-1", "order-2"],
    orderInternalIds: ["order-1", "order-2"],
    abstime: {
      orders: ["2024-01-01T00:10:00+00:00", "2024-01-01T00:12:00+00:00"],
      couriers: ["2024-01-01T00:00:00+00:00"],
    },
    combinedParams: {
      orders: {},
      depot: {},
      weights: {},
      couriers: {},
      additional: {},
    },
  },
});

const buildSolverResult = (): SolverResult => ({
  routes: [[0, 1, 2, 0]],
  t_delivery: { 1: 24, 2: 31 },
  skip: { 1: 0, 2: 0 },
  cert: { 1: 0, 2: 1 },
});

describe("mapSolverResult", () => {
  it("maps solver fields onto orders", () => {
    const response = mapSolverResult({
      solverInput: buildSolverInput(),
      solverResult: buildSolverResult(),
    });

    expect(response.ordersComputed).toEqual([
      {
        internalId: "order-1",
        orderExternalId: undefined,
        groupId: 0,
        routePos: 1,
        etaRelMin: 24,
        plannedC2eMin: 20,
        skip: undefined,
        cert: undefined,
        depotDirectMin: 5,
      },
      {
        internalId: "order-2",
        orderExternalId: undefined,
        groupId: 0,
        routePos: 2,
        etaRelMin: 31,
        plannedC2eMin: 25,
        skip: undefined,
        cert: 1,
        depotDirectMin: 7,
      },
    ]);

    const expectedColor = getStableColorFromSeed("route-order-1|order-2");

      expect(response.routesSegments).toEqual([
        {
          groupId: 0,
          color: expectedColor,
          polyline: [
            [1, 1],
            [2, 2],
          ],
          courierId: undefined,
          depotSegment: {
            from: [0, 0],
            to: [1, 1],
            mid: [0.5, 0.5],
            fromPos: 0,
          toPos: 1,
        },
        segments: [
          {
            from: [1, 1],
            to: [2, 2],
            mid: [1.5, 1.5],
            fromPos: 1,
            toPos: 2,
          },
        ],
        tooltip: "Маршрут 1: order-1, order-2",
      },
    ]);
  });

  it("respects wrapped solver payloads and skipped orders", () => {
    const solverResult: SolverResult & { result: SolverResult } = {
      routes: [],
      result: {
        routes: [[0, 1, 0]],
        t_delivery: { 1: 18, 2: 42 },
        skip: { 1: 0, 2: 1 },
        cert: { 1: 0, 2: 0 },
      },
    };

    const response = mapSolverResult({
      solverInput: buildSolverInput(),
      solverResult,
    });

    expect(response.ordersComputed).toEqual([
      expect.objectContaining({
        internalId: "order-1",
        groupId: 0,
        routePos: 1,
        etaRelMin: 18,
        plannedC2eMin: 14,
        skip: undefined,
        cert: undefined,
      }),
      expect.objectContaining({
        internalId: "order-2",
        groupId: undefined,
        routePos: undefined,
        etaRelMin: 42,
        plannedC2eMin: 36,
        skip: 1,
        cert: undefined,
      }),
    ]);

    const expectedColor = getStableColorFromSeed("route-order-1");

      expect(response.routesSegments).toEqual([
        {
          groupId: 0,
          color: expectedColor,
          polyline: [[1, 1]],
          courierId: undefined,
        depotSegment: {
          from: [0, 0],
          to: [1, 1],
          mid: [0.5, 0.5],
          fromPos: 0,
          toPos: 1,
        },
        segments: [],
        tooltip: "Маршрут 1: order-1",
      },
    ]);
  });
});

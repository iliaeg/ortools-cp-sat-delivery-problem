import { describe, expect, it } from "vitest";

import { mapSolverResult } from "@/processes/map-orders/lib/solverResultMapper";
import type { SolverInputPayload, SolverResult } from "@/shared/types/solver";

const buildSolverInput = (): SolverInputPayload => ({
  tau: [
    [0, 5, 7],
    [5, 0, 3],
    [7, 3, 0],
  ],
  K: 1,
  C: [10],
  box: [2, 1],
  c: [4, 6],
  r: [10, 12],
  a: [0],
  W_cert: 1_000,
  W_c2e: 1,
  W_skip: 10_000,
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
  T: { 1: 24, 2: 31 },
  skip: { 1: 0, 2: 0 },
  s: { 1: 0, 2: 1 },
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
        groupId: 0,
        routePos: 1,
        etaRelMin: 24,
        plannedC2eMin: 20,
        skip: 0,
        cert: 0,
      },
      {
        internalId: "order-2",
        groupId: 0,
        routePos: 2,
        etaRelMin: 31,
        plannedC2eMin: 25,
        skip: 0,
        cert: 1,
      },
    ]);
  });

  it("respects wrapped solver payloads and skipped orders", () => {
    const solverResult: SolverResult & { result: SolverResult } = {
      routes: [],
      result: {
        routes: [[0, 1, 0]],
        T: { 1: 18, 2: 42 },
        skip: { 1: 0, 2: 1 },
        s: { 1: 0, 2: 0 },
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
        skip: 0,
      }),
      expect.objectContaining({
        internalId: "order-2",
        groupId: undefined,
        routePos: undefined,
        etaRelMin: 42,
        plannedC2eMin: 36,
        skip: 1,
      }),
    ]);
  });
});

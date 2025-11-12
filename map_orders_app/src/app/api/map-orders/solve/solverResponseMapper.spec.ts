import { describe, expect, it } from "vitest";
import { mapSolverResult } from "@/processes/map-orders/lib/solverResultMapper";
import type { SolverInputPayload, SolverResult } from "@/shared/types/solver";
import { convertDomainResultToSolverResult } from "./solverResponseMapper";

const buildSolverInput = (): SolverInputPayload => ({
  request: {
    inputs: [
      {
        data: {
          current_timestamp_utc: "2024-01-01T00:00:00Z",
          travel_time_matrix_minutes: [
            [0, 5],
            [5, 0],
          ],
          orders: [
            {
              order_id: "order-1",
              boxes_count: 1,
              created_at_utc: "2024-01-01T00:00:00Z",
              expected_ready_at_utc: "2024-01-01T00:05:00Z",
            },
          ],
          couriers: [
            {
              courier_id: "courier-1",
              box_capacity: 3,
              expected_courier_return_at_utc: "2024-01-01T00:00:00Z",
            },
          ],
          optimization_weights: {
            certificate_penalty_weight: 100,
            click_to_eat_penalty_weight: 1,
            skip_order_penalty_weight: 1000,
          },
        },
      },
    ],
  },
  tau: [
    [0, 5],
    [5, 0],
  ],
  order_created_offset: [0],
  order_ready_offset: [5],
  courier_available_offset: [0],
  meta: {
    pointsLatLon: [
      [0, 0],
      [1, 1],
    ],
    mode: "MANUAL",
    osrmBaseUrl: "http://localhost",
    T0_iso: "2024-01-01T00:00:00.000Z",
    pointInternalIds: ["depot", "order-1"],
    orderInternalIds: ["order-1"],
    orderExternalIds: ["order-1"],
    courierExternalIds: ["courier-1"],
    abstime: {
      orders: ["2024-01-01T00:05:00.000Z"],
      couriers: ["2024-01-01T00:00:00.000Z"],
    },
    combinedParams: {
      orders: [],
      depot: {},
      weights: {},
      couriers: {},
      additional: {},
    },
  },
});

const mapOrders = (solverInput: SolverInputPayload, solverResult: SolverResult) =>
  mapSolverResult({ solverInput, solverResult });

describe("solverResponseMapper", () => {
  it("does not mark cert/skip when solver response flags are false-like", () => {
    const solverInput = buildSolverInput();
    const domainResponse = {
      current_timestamp_utc: "2024-01-01T00:00:00Z",
      couriers: [
        {
          courier_id: "courier-1",
          planned_departure_at_utc: "2024-01-01T00:00:00Z",
          delivery_sequence: [{ order_id: "order-1", position: 1 }],
        },
      ],
      orders: [
        {
          order_id: "order-1",
          assigned_courier_id: "courier-1",
          planned_delivery_at_utc: "2024-01-01T00:10:00Z",
          is_cert: "false",
          is_skipped: "0",
        },
      ],
    };

    const solverResult = convertDomainResultToSolverResult(domainResponse, solverInput);
    const mapped = mapOrders(solverInput, solverResult);
    expect(mapped.ordersComputed[0]?.cert).toBeUndefined();
    expect(mapped.ordersComputed[0]?.skip).toBeUndefined();
  });

  it("respects truthy flags from solver response", () => {
    const solverInput = buildSolverInput();
    const domainResponse = {
      current_timestamp_utc: "2024-01-01T00:00:00Z",
      couriers: [
        {
          courier_id: "courier-1",
          planned_departure_at_utc: "2024-01-01T00:00:00Z",
          delivery_sequence: [{ order_id: "order-1", position: 1 }],
        },
      ],
      orders: [
        {
          order_id: "order-1",
          assigned_courier_id: "courier-1",
          planned_delivery_at_utc: "2024-01-01T00:10:00Z",
          is_cert: "true",
          is_skipped: 1,
        },
      ],
    };

    const solverResult = convertDomainResultToSolverResult(domainResponse, solverInput);
    const mapped = mapOrders(solverInput, solverResult);
    expect(mapped.ordersComputed[0]?.cert).toBe(1);
    expect(mapped.ordersComputed[0]?.skip).toBe(1);
  });
});

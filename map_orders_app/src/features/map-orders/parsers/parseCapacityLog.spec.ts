import { buildStateFromCapacityLog, parseCapacityLogPayload } from "./parseCapacityLog";

describe("parseCapacityLog", () => {
  it("rejects legacy CP-SAT format without current_state/predictions", () => {
    const legacyRaw = JSON.stringify({
      Request: {
        RequestDto: {
          inputs: [
            {
              data: {
                current_timestamp_utc: "2026-04-01T18:27:54.8392629Z",
                orders: [{ order_id: "o1" }],
                couriers: [{ courier_id: "c1" }],
              },
            },
          ],
        },
      },
      Response: {
        Response: {
          status: "FEASIBLE",
          orders: [{ order_id: "o1" }],
          couriers: [{ courier_id: "c1", delivery_sequence: [] }],
        },
      },
    });

    expect(() => parseCapacityLogPayload(legacyRaw)).toThrow(
      /capacity log|current_state|predictions/i,
    );
  });

  it("accepts new Capacity format and builds state", () => {
    const payload = {
      Request: {
        RequestDto: {
          inputs: [
            {
              data: {
                current_state: {
                  unit: {
                    coordinates: { latitude: 54.720683, longitude: 20.498378 },
                  },
                  current_time_utc: "2026-04-01T18:27:54.8392629Z",
                  orders: [
                    {
                      order_id: "o1",
                      order_number: "314",
                      created_at_utc: "2026-04-01T17:58:58.0000000Z",
                      ready_at_utc: "2026-04-01T18:30:54.8392629Z",
                      delivery_coordinates: { latitude: 54.749367, longitude: 20.457778 },
                    },
                  ],
                  couriers: [
                    {
                      courier_id: "c1",
                      available_at_utc: "2026-04-01T18:27:43.0000000Z",
                    },
                  ],
                  travel_time_matrix_minutes: [
                    [0, 15],
                    [14, 0],
                  ],
                },
                solver_options: {
                  time_limit_seconds: 11,
                },
              },
            },
          ],
        },
      },
      Response: {
        status: "Feasible",
        ResponseDto: {
          predictions: {
            status: "FEASIBLE",
            dispatches: [
              {
                courier_id: "c1",
                planned_departure_at_utc: "2026-04-01T18:30:54.0000000Z",
                delivery_sequence: [
                  {
                    position: 1,
                    order_id: "o1",
                    planned_delivery_at_utc: "2026-04-01T18:45:54.0000000Z",
                    planned_c2e_minutes: 47,
                  },
                ],
              },
            ],
            order_plans: [
              {
                order_id: "o1",
                order_number: "314",
                planned_delivery_at_utc: "2026-04-01T18:45:54.0000000Z",
                planned_c2e_minutes: 47,
                assigned_courier_id: "c1",
                is_certificate: false,
                is_skipped: false,
              },
            ],
          },
        },
      },
    };
    const raw = JSON.stringify(payload);

    const parsed = parseCapacityLogPayload(raw);
    const parsedRecord = parsed as {
      Request?: {
        RequestDto?: {
          inputs?: Array<{ data?: { current_state?: { orders?: unknown[] } } }>;
        };
      };
    };
    expect(parsedRecord.Request?.RequestDto?.inputs?.[0]?.data?.current_state?.orders).toHaveLength(1);
    const state = buildStateFromCapacityLog(parsed);

    expect(state.cpSatStatus).toBe("FEASIBLE");
    expect(state.points).toHaveLength(2);
    expect(state.solverResult?.result.routes).toEqual([[0, 1, 0]]);
    expect(state.solverInput?.request).toEqual(payload.Request.RequestDto);
    expect(state.solverResult?.domainResponse).toEqual(payload.Response.ResponseDto);
  });

  it("parses full Payload-wrapped Capacity format and keeps UI-critical fields", () => {
    const payload = {
      Timestamp: "2026-04-01T18:50:11.9309876Z",
      Payload: {
        ActualUnitAndSettings: {
          Unit: {
            Address: {
              Coordinates: {
                Latitude: 54.70768738,
                Longitude: 20.58987045,
              },
            },
          },
        },
        ActualOrders: {
          OrdersForComputation: [
            {
              Id: "O1",
              Number: 54,
              AddressV2: {
                Coordinates: {
                  Latitude: 54.710502,
                  Longitude: 20.590429,
                },
              },
            },
            {
              Id: "O2",
              Number: 55,
              AddressV2: {
                Coordinates: {
                  Latitude: 54.746767,
                  Longitude: 20.583054,
                },
              },
            },
          ],
        },
        Request: {
          RequestDto: {
            inputs: [
              {
                data: {
                  current_state: {
                    unit: {
                      coordinates: {
                        latitude: 54.70768738,
                        longitude: 20.58987045,
                      },
                    },
                    current_time_utc: "2026-04-01T18:50:11.6927330Z",
                    travel_time_matrix_minutes: [
                      [0, 7, 15],
                      [5, 0, 15],
                      [10, 13, 0],
                    ],
                    orders: [
                      {
                        order_id: "o1",
                        order_number: "54",
                        created_at_utc: "2026-04-01T18:37:20.0000000Z",
                        ready_at_utc: "2026-04-01T18:59:19.0000000Z",
                        delivery_coordinates: {
                          latitude: 1,
                          longitude: 1,
                        },
                      },
                      {
                        order_id: "o2",
                        order_number: "55",
                        created_at_utc: "2026-04-01T18:38:34.0000000Z",
                        ready_at_utc: "2026-04-01T19:00:21.0000000Z",
                        delivery_coordinates: {
                          latitude: 2,
                          longitude: 2,
                        },
                      },
                    ],
                    couriers: [
                      {
                        courier_id: "c1",
                        available_at_utc: "2026-04-01T18:36:20.0000000Z",
                      },
                      {
                        courier_id: "c2",
                        available_at_utc: "2026-04-01T19:10:35.0000000Z",
                      },
                    ],
                  },
                  policy_context: {
                    max_batch_size: 3,
                    certificate_guard_band_minutes: 8,
                  },
                  solver_options: {
                    time_limit_seconds: 11,
                  },
                },
              },
            ],
          },
        },
        Response: {
          status: "Optimal",
          ResponseDto: {
            predictions: {
              status: "OPTIMAL",
              solution_summary: {
                objectives: {
                  phase2_objective_value: 48.64,
                },
              },
              dispatches: [
                {
                  courier_id: "c1",
                  planned_departure_at_utc: "2026-04-01T19:01:11.0000000Z",
                  planned_return_at_utc: "2026-04-01T19:33:11.0000000Z",
                  delivery_sequence: [
                    {
                      order_id: "o1",
                      position: 1,
                      planned_delivery_at_utc: "2026-04-01T19:08:11.0000000Z",
                      planned_c2e_minutes: 31,
                    },
                    {
                      order_id: "o2",
                      position: 2,
                      planned_delivery_at_utc: "2026-04-01T19:23:11.0000000Z",
                      planned_c2e_minutes: 45,
                    },
                  ],
                },
                {
                  courier_id: "c2",
                  planned_departure_at_utc: "2026-04-01T19:10:35.0000000Z",
                  planned_return_at_utc: "2026-04-01T19:28:35.0000000Z",
                  delivery_sequence: [],
                },
              ],
              order_plans: [
                {
                  order_id: "o1",
                  order_number: "54",
                  assigned_courier_id: "c1",
                  planned_delivery_at_utc: "2026-04-01T19:08:11.0000000Z",
                  planned_c2e_minutes: 31,
                  is_certificate: false,
                  is_skipped: false,
                },
                {
                  order_id: "o2",
                  order_number: "55",
                  assigned_courier_id: "c1",
                  planned_delivery_at_utc: "2026-04-01T19:23:11.0000000Z",
                  planned_c2e_minutes: 45,
                  is_certificate: false,
                  is_skipped: false,
                },
              ],
            },
          },
        },
      },
    };
    const raw = JSON.stringify(payload);

    const parsed = parseCapacityLogPayload(raw);
    const state = buildStateFromCapacityLog(parsed);

    expect(state.cpSatStatus).toBe("OPTIMAL");
    expect(state.points).toHaveLength(3);
    expect(state.solverResult?.result.routes).toEqual([[0, 1, 2, 0]]);

    expect(state.cpSatMetrics).toEqual({
      totalOrders: 2,
      assignedOrders: 2,
      totalCouriers: 2,
      assignedCouriers: 1,
      objectiveValue: 48.64,
      certCount: 0,
      skipCount: 0,
    });

    const depotPoint = state.points?.[0];
    const order1 = state.points?.find((point) => point.id?.toLowerCase() === "o1");
    const order2 = state.points?.find((point) => point.id?.toLowerCase() === "o2");

    expect(depotPoint?.lat).toBe(54.70768738);
    expect(depotPoint?.lon).toBe(20.58987045);
    expect(order1?.lat).toBe(54.710502);
    expect(order1?.lon).toBe(20.590429);
    expect(order2?.lat).toBe(54.746767);
    expect(order2?.lon).toBe(20.583054);
    expect(order1?.readyAt).toBe("18:59:19");
    expect(order2?.readyAt).toBe("19:00:21");
    expect(order1?.courierWaitMin).toBe(11);
    expect(order1?.plannedC2eMin).toBe(31);
    expect(order2?.plannedC2eMin).toBe(45);

    const couriers = JSON.parse(state.couriersText ?? "{}") as {
      courier_available_offset?: number[];
    };
    expect(couriers.courier_available_offset).toEqual([-14, 20]);

    const weights = JSON.parse(state.weightsText ?? "{}") as {
      max_batch_size?: number;
      certificate_guard_band_minutes?: number;
    };
    expect(weights.max_batch_size).toBe(3);
    expect(weights.certificate_guard_band_minutes).toBe(8);

    const additionalParams = JSON.parse(state.additionalParamsText ?? "{}") as {
      time_limit?: number;
      solver_settings?: { time_limit_seconds?: number };
    };
    expect(additionalParams.time_limit).toBe(11);
    expect(additionalParams.solver_settings?.time_limit_seconds).toBe(11);
    expect(state.solverInput?.request).toEqual(payload.Payload.Request.RequestDto);
    expect(state.solverResult?.domainResponse).toEqual(payload.Payload.Response.ResponseDto);
  });
});

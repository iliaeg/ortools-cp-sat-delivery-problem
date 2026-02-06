import {
  buildStateFromCpSatLog,
  CpSatLogParseError,
  parseCpSatLogPayload,
} from "./parseCpSatLog";

describe("parseCpSatLog", () => {
  it("parses new enriched payload format with nested RequestDto/Response", () => {
    const payload = {
      Payload: {
        assemblyVersion: "22389.0.0.0",
      },
      Request: {
        RequestDto: {
          inputs: [
            {
              data: {
                current_timestamp_utc: "2026-02-06T15:14:56.8614117Z",
                travel_time_matrix_minutes: [
                  [0, 10, 12],
                  [9, 0, 7],
                  [11, 8, 0],
                ],
                orders: [
                  {
                    order_id: "11f1036b4ab2c86a973df9858460b3f8",
                    order_number: 152,
                    boxes_count: 1,
                    created_at_utc: "2026-02-06T14:51:17.0000000Z",
                    expected_ready_at_utc: "2026-02-06T15:14:56.8614117Z",
                    coordinates: { latitude: 54.176731, longitude: 37.633553 },
                  },
                  {
                    order_id: "11f1036be0ff020c9588706b05e7dd59",
                    order_number: 155,
                    boxes_count: 1,
                    created_at_utc: "2026-02-06T14:55:30.0000000Z",
                    expected_ready_at_utc: "2026-02-06T15:14:56.8614117Z",
                    coordinates: { latitude: 54.18507385, longitude: 37.64756775 },
                  },
                ],
                couriers: [
                  {
                    courier_id: "ae8983cff1ffb47a11f0b40038de9b33",
                    box_capacity: 3,
                    expected_courier_return_at_utc: "2026-02-06T15:15:56.8614117Z",
                  },
                ],
                optimization_weights: {
                  courier_idle_penalty_weight: 60,
                  return_interval_starts_minutes: [0, 15, 30],
                  return_interval_penalty_weight: [10, 20, 60],
                },
                solver_settings: {
                  time_limit_seconds: 11,
                  max_parallel_workers: 8,
                  arc_allowing: { strategy: "ready_time_neighbours" },
                },
              },
            },
          ],
        },
      },
      Response: {
        Status: "Feasible",
        Response: {
          Status: "Feasible",
          Orders: [
            {
              OrderId: "11f1036b4ab2c86a973df9858460b3f8",
              OrderNumber: 152,
              AssignedCourierId: "ae8983cff1ffb47a11f0b40038de9b33",
              PlannedDeliveryAtUtc: "2026-02-06T15:28:56.0000000Z",
              IsCert: false,
              IsSkipped: false,
            },
            {
              OrderId: "11f1036be0ff020c9588706b05e7dd59",
              OrderNumber: 155,
              AssignedCourierId: "ae8983cff1ffb47a11f0b40038de9b33",
              PlannedDeliveryAtUtc: "2026-02-06T15:36:56.0000000Z",
              IsCert: false,
              IsSkipped: false,
            },
          ],
          Couriers: [
            {
              CourierId: "ae8983cff1ffb47a11f0b40038de9b33",
              PlannedDepartureAtUtc: "2026-02-06T15:15:56.0000000Z",
              PlannedReturnAtUtc: "2026-02-06T15:46:56.0000000Z",
              DeliverySequence: [
                { OrderId: "11f1036b4ab2c86a973df9858460b3f8", Position: 1 },
                { OrderId: "11f1036be0ff020c9588706b05e7dd59", Position: 2 },
              ],
            },
          ],
          Metrics: {
            TotalOrders: 2,
            AssignedOrders: 2,
            TotalCouriers: 1,
            AssignedCouriers: 1,
            ObjectiveValue: 1234,
          },
        },
      },
      UnitCoordinates: {
        Latitude: 54.197036,
        Longitude: 37.657817,
      },
      UnitId: "000d3abf84c3bb3011ecac32f7d30b49",
    };

    const result = buildStateFromCpSatLog(payload);

    expect(result.cpSatStatus).toBe("Feasible");
    expect(result.points).toHaveLength(3);
    expect(result.isFromCpSatLog).toBe(true);
    expect(result.solverInput?.request).toEqual(payload.Request.RequestDto);
    expect(result.solverResult?.domainResponse).toMatchObject({
      Status: "Feasible",
    });
    expect(result.weightsText).toContain("return_interval_starts_minutes");
    const additional = JSON.parse(result.additionalParamsText ?? "{}") as {
      time_limit?: number;
      workers?: number;
    };
    expect(additional.time_limit).toBe(11);
    expect(additional.workers).toBe(8);
    expect(result.solverResult?.result.routes).toHaveLength(1);
  });

  it("uses coordinates and order numbers from Payload.ActualState when absent in RequestDto", () => {
    const payload = {
      Payload: {
        ActualState: {
          Unit: {
            Address: {
              Coordinates: { Latitude: 54.197036, Longitude: 37.657817 },
            },
          },
          ActualState: {
            OrderActualState: {
              Orders: [
                {
                  Id: "o1",
                  Number: 152,
                  AddressV2: {
                    Coordinates: { Latitude: 54.176731, Longitude: 37.633553 },
                  },
                  CreatedDateTimeUtc: "2026-02-06T14:51:19.0000000Z",
                },
              ],
            },
          },
        },
      },
      Request: {
        RequestDto: {
          inputs: [
            {
              data: {
                current_timestamp_utc: "2026-02-06T15:14:56.8614117Z",
                travel_time_matrix_minutes: [
                  [0, 10],
                  [9, 0],
                ],
                orders: [
                  {
                    order_id: "o1",
                    order_number: 152,
                    boxes_count: 1,
                    created_at_utc: "2026-02-06T14:51:17.0000000Z",
                    expected_ready_at_utc: "2026-02-06T15:14:56.8614117Z",
                  },
                ],
                couriers: [
                  {
                    courier_id: "c1",
                    box_capacity: 3,
                    expected_courier_return_at_utc: "2026-02-06T15:15:56.8614117Z",
                  },
                ],
                optimization_weights: {},
                solver_settings: {},
              },
            },
          ],
        },
      },
      Response: {
        Status: "Feasible",
        Response: {
          Status: "Feasible",
          Orders: [
            {
              OrderId: "o1",
              AssignedCourierId: "c1",
              PlannedDeliveryAtUtc: "2026-02-06T15:28:56.0000000Z",
              IsCert: false,
              IsSkipped: false,
            },
          ],
          Couriers: [
            {
              CourierId: "c1",
              PlannedDepartureAtUtc: "2026-02-06T15:15:56.0000000Z",
              PlannedReturnAtUtc: "2026-02-06T15:36:56.0000000Z",
              DeliverySequence: [{ OrderId: "o1", Position: 1 }],
            },
          ],
        },
      },
      UnitCoordinates: { Latitude: 1, Longitude: 2 },
    };

    const result = buildStateFromCpSatLog(payload);
    const orderPoint = result.points?.find((point) => point.id === "o1");
    const depotPoint = result.points?.[0];

    expect(orderPoint).toBeDefined();
    expect(orderPoint?.lat).toBe(54.176731);
    expect(orderPoint?.lon).toBe(37.633553);
    expect(orderPoint?.orderNumber).toBe(152);
    expect(orderPoint?.boxes).toBe(1);
    expect(orderPoint?.createdAt).toBe("14:51:17");
    expect(depotPoint?.lat).toBe(54.197036);
    expect(depotPoint?.lon).toBe(37.657817);
  });

  it("extracts EnrichedPayload block from non-JSON log text", () => {
    const raw = `"Timestamp":"2025-12-23T16:38:55.5396534Z",\n"EnrichedPayload": {\n  "Request": {"CurrentTimestampUtc": "2025-12-23T16:38:55.1645153Z", "Orders": [{"OrderId": "o1"}], "Couriers": [{"CourierId":"c1"}]},\n  "Response": {"Status": "Optimal", "Orders": [{"OrderId": "o1"}], "Couriers": []}\n}`;

    const parsed = parseCpSatLogPayload(raw) as { EnrichedPayload?: unknown };

    expect(parsed.EnrichedPayload).toBeDefined();
  });

  it("extracts Payload, Request and Response blocks from non-JSON log text", () => {
    const raw = `"Timestamp":"2026-02-06T15:15:08.4211324Z",\n"Payload":{"assemblyVersion":"22389.0.0.0"},\n"Request":{"RequestDto":{"inputs":[{"data":{"orders":[{"order_id":"o1"}],"couriers":[{"courier_id":"c1"}],"current_timestamp_utc":"2026-02-06T15:14:56.8614117Z","travel_time_matrix_minutes":[[0,10],[9,0]],"optimization_weights":{},"solver_settings":{}}}]}},"Response":{"Response":{"Status":"Feasible","Orders":[{"OrderId":"o1"}],"Couriers":[]}}`;

    const parsed = parseCpSatLogPayload(raw) as {
      Payload?: unknown;
      Request?: unknown;
      Response?: unknown;
    };

    expect(parsed.Payload).toBeDefined();
    expect(parsed.Request).toBeDefined();
    expect(parsed.Response).toBeDefined();
  });

  it("throws on empty payload", () => {
    expect(() => parseCpSatLogPayload("   ")).toThrow(CpSatLogParseError);
  });
});

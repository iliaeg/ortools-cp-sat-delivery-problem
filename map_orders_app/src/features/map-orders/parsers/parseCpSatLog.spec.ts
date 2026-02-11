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

  it("does not use RequestDto order coordinates as fallback", () => {
    const payload = {
      Payload: {
        ActualUnitAndSettings: {
          Unit: {
            Address: {
              Coordinates: { Latitude: 54.197036, Longitude: 37.657817 },
            },
          },
        },
        ActualOrders: {},
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
                    coordinates: { latitude: 54.176731, longitude: 37.633553 },
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
    expect(orderPoint?.lat).toBe(0);
    expect(orderPoint?.lon).toBe(0);
    expect(orderPoint?.orderNumber).toBe(152);
    expect(orderPoint?.boxes).toBe(1);
    expect(orderPoint?.createdAt).toBe("14:51:17");
    expect(depotPoint?.lat).toBe(54.197036);
    expect(depotPoint?.lon).toBe(37.657817);
  });

  it("uses Request/Response and ActualOrders from enriched Payload container", () => {
    const payload = {
      Payload: {
        ActualUnitAndSettings: {
          Unit: {
            Address: {
              Coordinates: { Latitude: 54.197036, Longitude: 37.657817 },
            },
          },
        },
        ActualOrders: {
          OrdersForComputation: [
            {
              Id: "o1",
              Number: 152,
              AddressV2: {
                Coordinates: { Latitude: 54.176731, Longitude: 37.633553 },
              },
            },
          ],
        },
        Request: {
          RequestDto: {
            inputs: [
              {
                data: {
                  current_timestamp_utc: "2026-02-11T10:29:54.9516287Z",
                  travel_time_matrix_minutes: [
                    [0, 12],
                    [5, 0],
                  ],
                  orders: [
                    {
                      order_id: "o1",
                      boxes_count: 1,
                      created_at_utc: "2026-02-11T10:17:54.0000000Z",
                      expected_ready_at_utc: "2026-02-11T10:39:02.0000000Z",
                    },
                  ],
                  couriers: [
                    {
                      courier_id: "c1",
                      box_capacity: 3,
                      expected_courier_return_at_utc: "2026-02-11T10:45:48.0000000Z",
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
          Status: "Optimal",
          Response: {
            Status: "Optimal",
            Orders: [
              {
                OrderId: "o1",
                OrderNumber: 152,
                AssignedCourierId: "c1",
                PlannedDeliveryAtUtc: "2026-02-11T11:03:54.0000000Z",
                IsCert: false,
                IsSkipped: false,
              },
            ],
            Couriers: [
              {
                CourierId: "c1",
                PlannedDepartureAtUtc: "2026-02-11T10:45:54.0000000Z",
                PlannedReturnAtUtc: "2026-02-11T11:15:54.0000000Z",
                DeliverySequence: [{ OrderId: "o1", Position: 1 }],
              },
            ],
          },
        },
      },
    };

    const result = buildStateFromCpSatLog(payload);
    const depotPoint = result.points?.[0];
    const orderPoint = result.points?.find((point) => point.id === "o1");

    expect(result.cpSatStatus).toBe("Optimal");
    expect(result.solverInput?.request).toEqual(payload.Payload.Request.RequestDto);
    expect(orderPoint?.lat).toBe(54.176731);
    expect(orderPoint?.lon).toBe(37.633553);
    expect(orderPoint?.orderNumber).toBe(152);
    expect(depotPoint?.lat).toBe(54.197036);
    expect(depotPoint?.lon).toBe(37.657817);
  });

  it("uses AddressV2 coordinates for actual orders in import", () => {
    const payload = {
      Payload: {
        ActualUnitAndSettings: {
          Unit: {
            Address: {
              Coordinates: { Latitude: 54.197036, Longitude: 37.657817 },
            },
          },
        },
        ActualOrders: {
          OrdersForComputation: [
            {
              Id: "o1",
              Number: 152,
              Coordinates: { Latitude: 1, Longitude: 2 },
              AddressV2: {
                Coordinates: { Latitude: 54.176731, Longitude: 37.633553 },
              },
            },
          ],
        },
      },
      Request: {
        RequestDto: {
          inputs: [
            {
              data: {
                current_timestamp_utc: "2026-02-11T10:29:54.9516287Z",
                travel_time_matrix_minutes: [
                  [0, 12],
                  [5, 0],
                ],
                orders: [
                  {
                    order_id: "o1",
                    boxes_count: 1,
                    created_at_utc: "2026-02-11T10:17:54.0000000Z",
                    expected_ready_at_utc: "2026-02-11T10:39:02.0000000Z",
                  },
                ],
                couriers: [
                  {
                    courier_id: "c1",
                    box_capacity: 3,
                    expected_courier_return_at_utc: "2026-02-11T10:45:48.0000000Z",
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
        Status: "Optimal",
        Response: {
          Status: "Optimal",
          Orders: [
            {
              OrderId: "o1",
              AssignedCourierId: "c1",
              PlannedDeliveryAtUtc: "2026-02-11T11:03:54.0000000Z",
              IsCert: false,
              IsSkipped: false,
            },
          ],
          Couriers: [
            {
              CourierId: "c1",
              PlannedDepartureAtUtc: "2026-02-11T10:45:54.0000000Z",
              PlannedReturnAtUtc: "2026-02-11T11:15:54.0000000Z",
              DeliverySequence: [{ OrderId: "o1", Position: 1 }],
            },
          ],
        },
      },
    };

    const result = buildStateFromCpSatLog(payload);
    const orderPoint = result.points?.find((point) => point.id === "o1");

    expect(orderPoint?.lat).toBe(54.176731);
    expect(orderPoint?.lon).toBe(37.633553);
  });

  it("uses top-level ActualOrders and ActualUnitAndSettings when they are outside Payload", () => {
    const payload = {
      Payload: {},
      ActualUnitAndSettings: {
        Unit: {
          Address: {
            Coordinates: { Latitude: 61.665774, Longitude: 50.831152 },
          },
        },
      },
      ActualOrders: {
        OrdersForComputation: [
          {
            Id: "11F10732CCC5CC5BAD2F51F881353539",
            Number: 131,
            AddressV2: {
              Coordinates: { Latitude: 61.659611, Longitude: 50.834835 },
            },
          },
        ],
      },
      Request: {
        RequestDto: {
          inputs: [
            {
              data: {
                current_timestamp_utc: "2026-02-11T10:29:54.9516287Z",
                travel_time_matrix_minutes: [
                  [0, 12],
                  [5, 0],
                ],
                orders: [
                  {
                    order_id: "11f10732ccc5cc5bad2f51f881353539",
                    boxes_count: 1,
                    created_at_utc: "2026-02-11T10:17:54.0000000Z",
                    expected_ready_at_utc: "2026-02-11T10:39:02.0000000Z",
                  },
                ],
                couriers: [
                  {
                    courier_id: "f675042f77f7883e11ee73117608f345",
                    box_capacity: 3,
                    expected_courier_return_at_utc: "2026-02-11T10:45:48.0000000Z",
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
        Status: "Optimal",
        Response: {
          Status: "Optimal",
          Orders: [
            {
              OrderId: "11f10732ccc5cc5bad2f51f881353539",
              AssignedCourierId: "f675042f77f7883e11ee73117608f345",
              PlannedDeliveryAtUtc: "2026-02-11T11:03:54.0000000Z",
              IsCert: false,
              IsSkipped: false,
            },
          ],
          Couriers: [
            {
              CourierId: "f675042f77f7883e11ee73117608f345",
              PlannedDepartureAtUtc: "2026-02-11T10:45:54.0000000Z",
              PlannedReturnAtUtc: "2026-02-11T11:15:54.0000000Z",
              DeliverySequence: [
                { OrderId: "11f10732ccc5cc5bad2f51f881353539", Position: 1 },
              ],
            },
          ],
        },
      },
    };

    const result = buildStateFromCpSatLog(payload);
    const orderPoint = result.points?.find(
      (point) => point.id === "11f10732ccc5cc5bad2f51f881353539",
    );
    const depotPoint = result.points?.[0];

    expect(orderPoint?.lat).toBe(61.659611);
    expect(orderPoint?.lon).toBe(50.834835);
    expect(depotPoint?.lat).toBe(61.665774);
    expect(depotPoint?.lon).toBe(50.831152);
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

  it("extracts top-level ActualOrders block from non-JSON log text", () => {
    const raw = `"Timestamp":"2026-02-11T10:29:56.3642592Z",\n"Payload":{"x":1},\n"ActualOrders":{"OrdersForComputation":[{"Id":"o1","AddressV2":{"Coordinates":{"Latitude":61.659611,"Longitude":50.834835}}}]},\n"Request":{"RequestDto":{"inputs":[{"data":{"orders":[{"order_id":"o1"}],"couriers":[{"courier_id":"c1"}],"current_timestamp_utc":"2026-02-11T10:29:54.9516287Z","travel_time_matrix_minutes":[[0,1],[1,0]],"optimization_weights":{},"solver_settings":{}}}]}},"Response":{"Response":{"Status":"Optimal","Orders":[{"OrderId":"o1"}],"Couriers":[]}}`;

    const parsed = parseCpSatLogPayload(raw) as {
      ActualOrders?: unknown;
    };

    expect(parsed.ActualOrders).toBeDefined();
  });

  it("throws on empty payload", () => {
    expect(() => parseCpSatLogPayload("   ")).toThrow(CpSatLogParseError);
  });
});

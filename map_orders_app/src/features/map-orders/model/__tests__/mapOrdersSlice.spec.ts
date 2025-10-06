import { describe, expect, it } from "vitest";

import reducer, {
  addPoint,
  applyComputedFields,
  resetSolverResult,
  setShowDepotSegments,
  setShowRoutePositions,
  setManualTauText,
  setUseManualTau,
  setSolverResult,
} from "@/features/map-orders/model/mapOrdersSlice";
import type { SolverSolveResponse } from "@/shared/types/solver";

const createInitialState = () => reducer(undefined, { type: "@@INIT" });

describe("mapOrdersSlice", () => {
  it("applyComputedFields stores solver-derived values", () => {
    const ordersComputed = {
      internalId: "order-1",
      groupId: 3,
      routePos: 2,
      etaRelMin: 45,
      plannedC2eMin: 90,
      skip: 0,
      cert: 1,
      depotDirectMin: 12,
    };

    let state = createInitialState();
    state = reducer(state, addPoint({ internalId: ordersComputed.internalId }));
    state = reducer(state, applyComputedFields([ordersComputed]));

    const point = state.data.points.find(
      ({ internalId }) => internalId === ordersComputed.internalId,
    );

    expect(point).toBeDefined();
    expect(point).toMatchObject({
      groupId: ordersComputed.groupId,
      routePos: ordersComputed.routePos,
      etaRelMin: ordersComputed.etaRelMin,
      plannedC2eMin: ordersComputed.plannedC2eMin,
      skip: ordersComputed.skip,
      cert: ordersComputed.cert,
      depotDirectMin: ordersComputed.depotDirectMin,
    });
  });

  it("resetSolverResult clears solver-derived point fields", () => {
    const ordersComputed = {
      internalId: "order-2",
      groupId: 4,
      routePos: 5,
      etaRelMin: 30,
      plannedC2eMin: 60,
      skip: 1,
      cert: 0,
      depotDirectMin: 18,
    };

    const solverResponse: SolverSolveResponse = {
      result: { routes: [] },
      ordersComputed: [ordersComputed],
      routesSegments: [],
    };

    let state = createInitialState();
    state = reducer(state, addPoint({ internalId: ordersComputed.internalId }));
    state = reducer(state, setSolverResult(solverResponse));
    state = reducer(state, applyComputedFields(solverResponse.ordersComputed));
    state = reducer(state, resetSolverResult());

    const point = state.data.points.find(
      ({ internalId }) => internalId === ordersComputed.internalId,
    );

    expect(state.data.solverResult).toBeNull();
    expect(point).toBeDefined();
    expect(point?.groupId).toBeUndefined();
    expect(point?.routePos).toBeUndefined();
    expect(point?.etaRelMin).toBeUndefined();
    expect(point?.plannedC2eMin).toBeUndefined();
    expect(point?.skip).toBeUndefined();
    expect(point?.cert).toBeUndefined();
    expect(point?.depotDirectMin).toBeUndefined();
  });

  it("setShowRoutePositions toggles persisted flag", () => {
    let state = createInitialState();
    expect(state.data.showRoutePositions).toBe(true);

    state = reducer(state, setShowRoutePositions(false));
    expect(state.data.showRoutePositions).toBe(false);

    state = reducer(state, setShowRoutePositions(true));
    expect(state.data.showRoutePositions).toBe(true);
  });

  it("setShowDepotSegments toggles persisted flag", () => {
    let state = createInitialState();
    expect(state.data.showDepotSegments).toBe(false);

    state = reducer(state, setShowDepotSegments(true));
    expect(state.data.showDepotSegments).toBe(true);

    state = reducer(state, setShowDepotSegments(false));
    expect(state.data.showDepotSegments).toBe(false);
  });

  it("manages manual tau fields", () => {
    let state = createInitialState();
    expect(state.data.manualTauText).toBe("");
    expect(state.data.useManualTau).toBe(false);

    state = reducer(state, setManualTauText("[[0,1],[1,0]]"));
    expect(state.data.manualTauText).toBe("[[0,1],[1,0]]");

    state = reducer(state, setUseManualTau(true));
    expect(state.data.useManualTau).toBe(true);
  });
});

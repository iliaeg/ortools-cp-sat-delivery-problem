import { createSelector } from "@reduxjs/toolkit";
import { RootState } from "@/shared/store";
import { DeliveryPoint } from "@/shared/types/points";

export const selectMapOrdersState = (state: RootState) => state.mapOrders;

export const selectPoints = createSelector(
  selectMapOrdersState,
  (mapOrders) => mapOrders.data.points,
);

export const selectDepot = createSelector(selectPoints, (points) =>
  points.find((point) => point.kind === "depot") ?? null,
);

export const selectOrders = createSelector(selectPoints, (points) =>
  points.filter((point) => point.kind === "order"),
);

export const selectMapView = createSelector(selectMapOrdersState, (state) => ({
  center: state.data.mapCenter,
  zoom: state.data.mapZoom,
}));

export const selectSolverInput = createSelector(
  selectMapOrdersState,
  (state) => state.data.solverInput,
);

export const selectSolverResult = createSelector(
  selectMapOrdersState,
  (state) => state.data.solverResult,
);

export const selectRouteSegments = createSelector(
  selectSolverResult,
  (solverResult) => solverResult?.routesSegments ?? [],
);

export const selectShowSolverRoutes = createSelector(
  selectMapOrdersState,
  (state) => state.data.showSolverRoutes,
);

export const selectWarnings = createSelector(
  selectMapOrdersState,
  (state) => state.ui.warnings,
);

export const selectUiFlags = createSelector(selectMapOrdersState, (state) => ({
  isLoading: state.ui.isLoading,
  isSaving: state.ui.isSaving,
  isBuildingSolverInput: state.ui.isBuildingSolverInput,
  isSolving: state.ui.isSolving,
}));

export const selectSolverComputedColumnsVisible = createSelector(
  selectPoints,
  (points: DeliveryPoint[]) =>
    points.some(
      (point) =>
        point.groupId !== undefined ||
        point.routePos !== undefined ||
        point.etaRelMin !== undefined ||
        point.plannedC2eMin !== undefined ||
        point.skip !== undefined ||
        point.cert !== undefined,
    ),
);

export const selectControlTexts = createSelector(selectMapOrdersState, (state) => ({
  couriersText: state.data.couriersText,
  weightsText: state.data.weightsText,
  additionalParamsText: state.data.additionalParamsText,
  t0Time: state.data.t0Time,
  osrmBaseUrl: state.data.osrmBaseUrl,
}));

export const selectLastSavedAt = createSelector(
  selectMapOrdersState,
  (state) => state.data.lastSavedAtIso,
);

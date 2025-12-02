import { createSelector } from "@reduxjs/toolkit";
import { RootState } from "@/shared/store";
import type { SolverDomainMetrics } from "@/shared/types/solver";

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

export type AllowedArcsByKey = Record<string, Record<string, boolean>>;

export const selectAllowedArcsByKey = createSelector(
  selectSolverResult,
  (solverResult): AllowedArcsByKey | null => {
    const domain = solverResult?.domainResponse;
    if (!domain) {
      return null;
    }
    const metricsNode =
      (domain.metrics as SolverDomainMetrics | Record<string, unknown> | undefined)
      ?? ((domain as unknown as Record<string, unknown>).Metrics as
        | SolverDomainMetrics
        | Record<string, unknown>
        | undefined);
    const anyMetrics = metricsNode as (Record<string, unknown> | undefined);
    const arcsNode =
      (anyMetrics?.arcs as Record<string, unknown> | undefined)
      ?? (anyMetrics?.Arcs as Record<string, unknown> | undefined);
    const rawAllowed =
      (arcsNode?.allowed_arcs as unknown)
      ?? (arcsNode?.AllowedArcs as unknown);
    if (!Array.isArray(rawAllowed) || rawAllowed.length === 0) {
      return null;
    }

    const map: AllowedArcsByKey = {};
    rawAllowed.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) {
        return;
      }
      const [fromRaw, toRaw] = entry;
      if (typeof fromRaw !== "string" || typeof toRaw !== "string") {
        return;
      }
      const fromKey = fromRaw.trim().toLowerCase();
      const toKey = toRaw.trim().toLowerCase();
      if (!fromKey || !toKey) {
        return;
      }
      if (!map[fromKey]) {
        map[fromKey] = {};
      }
      map[fromKey][toKey] = true;
    });

    return Object.keys(map).length ? map : null;
  },
);

export const selectRouteSegments = createSelector(
  selectSolverResult,
  (solverResult) => solverResult?.routesSegments ?? [],
);

export const selectShowSolverRoutes = createSelector(
  selectMapOrdersState,
  (state) => state.data.showSolverRoutes,
);

export const selectShowDepotSegments = createSelector(
  selectMapOrdersState,
  (state) => state.data.showDepotSegments,
);

export const selectShowRoutePositions = createSelector(
  selectMapOrdersState,
  (state) => state.data.showRoutePositions,
);

export const selectShowDepartingNowRoutes = createSelector(
  selectMapOrdersState,
  (state) => state.data.showDepartingNowRoutes,
);

export const selectShowReadyNowOrders = createSelector(
  selectMapOrdersState,
  (state) => state.data.showReadyNowOrders,
);

export const selectDepartingWindowMinutes = createSelector(
  selectMapOrdersState,
  (state) => state.data.departingWindowMinutes,
);

export const selectWarnings = createSelector(
  selectMapOrdersState,
  (state) => state.ui.warnings,
);

export const selectCpSatStatus = createSelector(
  selectMapOrdersState,
  (state) => state.data.cpSatStatus,
);

export const selectCpSatMetrics = createSelector(
  selectMapOrdersState,
  (state) => state.data.cpSatMetrics,
);

export const selectViewportLocked = createSelector(
  selectMapOrdersState,
  (state) => state.data.viewportLocked,
);

export const selectCurrentTime = createSelector(
  selectMapOrdersState,
  (state) => state.data.t0Time,
);

export const selectUiFlags = createSelector(selectMapOrdersState, (state) => ({
  isLoading: state.ui.isLoading,
  isSaving: state.ui.isSaving,
  isBuildingSolverInput: state.ui.isBuildingSolverInput,
  isSolving: state.ui.isSolving,
}));

export const selectSolverSignatures = createSelector(selectMapOrdersState, (state) => ({
  lastSolverInputSignature: state.ui.lastSolverInputSignature,
  lastSolverResultSignature: state.ui.lastSolverResultSignature,
}));

export const selectControlTexts = createSelector(selectMapOrdersState, (state) => ({
  couriersText: state.data.couriersText,
  weightsText: state.data.weightsText,
  additionalParamsText: state.data.additionalParamsText,
  t0Time: state.data.t0Time,
  osrmBaseUrl: state.data.osrmBaseUrl,
  manualTauText: state.data.manualTauText,
  useManualTau: state.data.useManualTau,
}));

export const selectLastSavedAt = createSelector(
  selectMapOrdersState,
  (state) => state.data.lastSavedAtIso,
);

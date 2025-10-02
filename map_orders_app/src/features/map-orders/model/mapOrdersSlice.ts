import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { v4 as uuidv4 } from "uuid";
import {
  DeliveryPoint,
  MapOrdersPersistedState,
  MapOrdersState,
  MapOrdersUiState,
  PointKind,
} from "@/shared/types/points";
import type {
  OrdersComputedPatch,
  SolverInputPayload,
  SolverSolveResponse,
} from "@/shared/types/solver";
import { OREL_CENTER, DEFAULT_ZOOM } from "@/shared/constants/map";
import { getClientEnv } from "@/shared/config/env";
import {
  DEFAULT_ADDITIONAL_PARAMS_TEXT,
  DEFAULT_COURIERS_TEXT,
  DEFAULT_WEIGHTS_TEXT,
  ensureDefaultText,
} from "@/shared/constants/defaults";

const env = getClientEnv();

const initialPersistedState: MapOrdersPersistedState = {
  points: [],
  mapCenter: OREL_CENTER,
  mapZoom: DEFAULT_ZOOM,
  couriersText: DEFAULT_COURIERS_TEXT,
  weightsText: DEFAULT_WEIGHTS_TEXT,
  additionalParamsText: DEFAULT_ADDITIONAL_PARAMS_TEXT,
  t0Time: "09:00:00",
  osrmBaseUrl: env.osrmBaseUrl,
  showSolverRoutes: true,
  solverInput: null,
  solverResult: null,
  lastSavedAtIso: undefined,
};

const initialUiState: MapOrdersUiState = {
  isLoading: false,
  isSaving: false,
  isBuildingSolverInput: false,
  isSolving: false,
  warnings: [],
  error: undefined,
  lastSolverInputSignature: undefined,
  lastSolverResultSignature: undefined,
};

const initialState: MapOrdersState = {
  data: initialPersistedState,
  ui: initialUiState,
};

const normalizeSeq = (points: DeliveryPoint[]): DeliveryPoint[] =>
  points
    .map((point, index) => ({
      ...point,
      seq: index + 1,
    }))
    .sort((a, b) => a.seq - b.seq);

const ensureDepotConstraints = (points: DeliveryPoint[]): DeliveryPoint[] => {
  const depots = points.filter((point) => point.kind === "depot");
  if (depots.length === 0 && points.length > 0) {
    // Promote the first point to depot if none exists.
    const [first, ...rest] = points;
    return normalizeSeq([
      { ...first, kind: "depot" as PointKind },
      ...rest.map((point) => ({ ...point, kind: "order" as PointKind })),
    ]);
  }

  if (depots.length > 1) {
    const [, ...others] = depots;
    const corrected = points.map((point) => {
      if (others.some((other) => other.internalId === point.internalId)) {
        return { ...point, kind: "order" as PointKind };
      }
      return point;
    });
    return normalizeSeq(corrected);
  }

  return normalizeSeq(points);
};

const createPoint = (partial: Partial<DeliveryPoint>): DeliveryPoint => ({
  internalId: partial.internalId ?? uuidv4(),
  id: partial.id ?? "",
  kind: (partial.kind ?? "order") as PointKind,
  seq: 0,
  lat: partial.lat ?? OREL_CENTER[0],
  lon: partial.lon ?? OREL_CENTER[1],
  boxes: partial.boxes ?? 0,
  createdAt: partial.createdAt ?? "00:00:00",
  readyAt: partial.readyAt ?? "00:00:00",
  extraJson: partial.extraJson ?? "{}",
  groupId: partial.groupId,
  routePos: partial.routePos,
  etaRelMin: partial.etaRelMin,
  plannedC2eMin: partial.plannedC2eMin,
  skip: partial.skip,
  cert: partial.cert,
});

const mapOrdersSlice = createSlice({
  name: "mapOrders",
  initialState,
  reducers: {
    resetState: () => initialState,
    setPersistedState: (
      state,
      action: PayloadAction<Partial<MapOrdersPersistedState>>,
    ) => {
      state.data = {
        ...state.data,
        ...action.payload,
        points: action.payload.points
          ? ensureDepotConstraints(action.payload.points as DeliveryPoint[])
          : state.data.points,
        couriersText: ensureDefaultText(
          action.payload.couriersText ?? state.data.couriersText,
          DEFAULT_COURIERS_TEXT,
        ),
        weightsText: ensureDefaultText(
          action.payload.weightsText ?? state.data.weightsText,
          DEFAULT_WEIGHTS_TEXT,
        ),
        additionalParamsText: ensureDefaultText(
          action.payload.additionalParamsText ?? state.data.additionalParamsText,
          DEFAULT_ADDITIONAL_PARAMS_TEXT,
        ),
      };
    },
    setUiState: (state, action: PayloadAction<Partial<MapOrdersUiState>>) => {
      state.ui = { ...state.ui, ...action.payload };
    },
    addPoint: (state, action: PayloadAction<Partial<DeliveryPoint>>) => {
      const newPoint = createPoint(action.payload);
      const nextPoints = ensureDepotConstraints([
        ...state.data.points,
        newPoint,
      ]);
      state.data.points = nextPoints;
    },
    updatePoint: (
      state,
      action: PayloadAction<{ internalId: string; patch: Partial<DeliveryPoint> }>,
    ) => {
      const nextPoints = state.data.points.map((point) =>
        point.internalId === action.payload.internalId
          ? { ...point, ...action.payload.patch }
          : point,
      );
      state.data.points = ensureDepotConstraints(nextPoints);
    },
    removePoint: (state, action: PayloadAction<string>) => {
      const nextPoints = state.data.points.filter(
        (point) => point.internalId !== action.payload,
      );
      state.data.points = ensureDepotConstraints(nextPoints);
    },
    replacePoints: (state, action: PayloadAction<DeliveryPoint[]>) => {
      state.data.points = ensureDepotConstraints(action.payload);
    },
    clearPoints: (state) => {
      state.data.points = [];
      state.data.solverResult = null;
      state.data.solverInput = null;
    },
    setMapView: (
      state,
      action: PayloadAction<{ center?: [number, number]; zoom?: number }>,
    ) => {
      state.data.mapCenter = action.payload.center ?? state.data.mapCenter;
      state.data.mapZoom = action.payload.zoom ?? state.data.mapZoom;
    },
    setCouriersText: (state, action: PayloadAction<string>) => {
      state.data.couriersText = action.payload;
    },
    setWeightsText: (state, action: PayloadAction<string>) => {
      state.data.weightsText = action.payload;
    },
    setAdditionalParamsText: (state, action: PayloadAction<string>) => {
      state.data.additionalParamsText = action.payload;
    },
    setT0Time: (state, action: PayloadAction<string>) => {
      state.data.t0Time = action.payload;
    },
    setOsrmBaseUrl: (state, action: PayloadAction<string>) => {
      state.data.osrmBaseUrl = action.payload;
    },
    setShowSolverRoutes: (state, action: PayloadAction<boolean>) => {
      state.data.showSolverRoutes = action.payload;
    },
    setSolverInput: (
      state,
      action: PayloadAction<SolverInputPayload | null>,
    ) => {
      state.data.solverInput = action.payload;
    },
    setSolverResult: (
      state,
      action: PayloadAction<SolverSolveResponse | null>,
    ) => {
      state.data.solverResult = action.payload;
    },
    applyComputedFields: (
      state,
      action: PayloadAction<
        OrdersComputedPatch[]
      >,
    ) => {
      const patchMap = new Map(
        action.payload.map((item) => [item.internalId, item]),
      );
      state.data.points = state.data.points.map((point) => {
        const patch = patchMap.get(point.internalId);
        if (!patch) {
          return point;
        }
        return {
          ...point,
          ...patch,
        };
      });
    },
    setLastSavedAt: (state, action: PayloadAction<string | undefined>) => {
      state.data.lastSavedAtIso = action.payload;
    },
    resetSolverResult: (state) => {
      state.data.solverResult = null;
      state.data.points = state.data.points.map((point) => ({
        ...point,
        groupId: undefined,
        routePos: undefined,
        etaRelMin: undefined,
        plannedC2eMin: undefined,
        skip: undefined,
        cert: undefined,
      }));
    },
  },
});

export const {
  resetState,
  setPersistedState,
  setUiState,
  addPoint,
  updatePoint,
  removePoint,
  replacePoints,
  clearPoints,
  setMapView,
  setCouriersText,
  setWeightsText,
  setAdditionalParamsText,
  setT0Time,
  setOsrmBaseUrl,
  setShowSolverRoutes,
  setSolverInput,
  setSolverResult,
  applyComputedFields,
  setLastSavedAt,
  resetSolverResult,
} = mapOrdersSlice.actions;

export default mapOrdersSlice.reducer;

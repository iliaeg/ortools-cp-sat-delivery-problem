import type {
  SolverInputPayload,
  SolverSolveResponse,
} from "@/shared/types/solver";

export type PointKind = "depot" | "order";

export interface BasePoint {
  /** Internal UUID used by the UI */
  internalId: string;
  /** External ID entered by the user */
  id: string;
  kind: PointKind;
  seq: number;
  lat: number;
  lon: number;
  boxes: number;
  createdAt: string; // HH:MM:SS
  readyAt: string; // HH:MM:SS
  extraJson: string; // JSON string, validated on submit
}

export interface SolverComputedFields {
  groupId?: number;
  routePos?: number;
  etaRelMin?: number;
  plannedC2eMin?: number;
  skip?: boolean;
  cert?: boolean;
}

export type DeliveryPoint = BasePoint & SolverComputedFields;

export interface MapRouteSegment {
  groupId: number;
  color: string;
  polyline: [number, number][];
  tooltip: string;
  segments: Array<{
    from: [number, number];
    to: [number, number];
  }>;
}

export interface MapOrdersPersistedState {
  points: DeliveryPoint[];
  mapCenter: [number, number];
  mapZoom: number;
  couriersText: string;
  weightsText: string;
  additionalParamsText: string;
  t0Time: string; // HH:MM:SS
  osrmBaseUrl: string;
  showSolverRoutes: boolean;
  solverInput: SolverInputPayload | null;
  solverResult: SolverSolveResponse | null;
  lastSavedAtIso?: string;
  solverColumnsVisible?: boolean;
}

export interface MapOrdersUiState {
  isLoading: boolean;
  isSaving: boolean;
  isBuildingSolverInput: boolean;
  isSolving: boolean;
  warnings: string[];
  error?: string;
  lastSolverInputSignature?: string;
  lastSolverResultSignature?: string;
}

export interface MapOrdersState {
  data: MapOrdersPersistedState;
  ui: MapOrdersUiState;
}

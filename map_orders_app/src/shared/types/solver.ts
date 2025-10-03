export interface SolverInputMeta {
  pointsLatLon: [number, number][];
  mode: string;
  osrmBaseUrl: string;
  T0_iso: string;
  pointInternalIds: string[];
  orderInternalIds: string[];
  abstime: {
    orders: string[];
    couriers: string[];
  };
  combinedParams: {
    orders: unknown;
    depot: unknown;
    weights: unknown;
    couriers: unknown;
    additional: unknown;
  };
}

export interface SolverInputPayload {
  tau: number[][];
  K: number;
  C: number[];
  box: number[];
  c: number[];
  r: number[];
  a: number[];
  W_cert: number;
  W_c2e: number;
  W_skip: number;
  meta: SolverInputMeta;
}

export interface SolverRouteResult {
  route: number[];
  eta: number[];
}

export type SolverVector = number[] | Record<number, number>;

export interface SolverResult {
  routes: number[][];
  T?: SolverVector;
  t?: SolverVector;
  t_dep?: SolverVector;
  skip?: SolverVector;
  s?: SolverVector;
  meta?: unknown;
}

export interface SolverInputResponse {
  input: SolverInputPayload;
  warnings: string[];
}

export interface OrdersComputedPatch {
  internalId: string;
  groupId?: number;
  routePos?: number;
  etaRelMin?: number;
  plannedC2eMin?: number;
  skip?: number;
  cert?: number;
  depotDirectMin?: number;
}

export interface RoutesSegmentDto {
  groupId: number;
  color: string;
  polyline: [number, number][];
  tooltip: string;
  segments: Array<{
    from: [number, number];
    to: [number, number];
    mid: [number, number];
    fromPos: number;
    toPos: number;
  }>;
  depotSegment?: {
    from: [number, number];
    to: [number, number];
    mid: [number, number];
    fromPos: number;
    toPos: number;
  };
}

export interface SolverSolveResponse {
  result: SolverResult;
  ordersComputed: OrdersComputedPatch[];
  routesSegments: RoutesSegmentDto[];
}

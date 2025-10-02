export interface SolverInputMeta {
  ordersExtra: unknown[];
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
  skip?: boolean;
  cert?: boolean;
}

export interface RoutesSegmentDto {
  groupId: number;
  color: string;
  polyline: [number, number][];
  tooltip: string;
}

export interface SolverSolveResponse {
  result: SolverResult;
  ordersComputed: OrdersComputedPatch[];
  routesSegments: RoutesSegmentDto[];
}

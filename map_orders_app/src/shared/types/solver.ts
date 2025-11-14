export interface SolverInputMeta {
  pointsLatLon: [number, number][];
  mode: string;
  osrmBaseUrl: string;
  T0_iso: string;
  pointInternalIds: string[];
  orderInternalIds: string[];
  orderExternalIds?: string[];
  courierExternalIds?: string[];
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

export interface SolverInvocationOrder {
  order_id: string;
  boxes_count: number;
  created_at_utc: string;
  expected_ready_at_utc: string;
}

export interface SolverInvocationCourier {
  courier_id: string;
  box_capacity: number;
  expected_courier_return_at_utc: string;
}

export interface SolverInvocationWeights {
  certificate_penalty_weight: number;
  click_to_eat_penalty_weight: number;
  skip_order_penalty_weight?: number;
}

export interface SolverInvocationSettings {
  time_limit_seconds?: number;
  max_parallel_workers?: number;
}

export interface SolverInvocationData {
  current_timestamp_utc: string;
  travel_time_matrix_minutes: number[][];
  orders: SolverInvocationOrder[];
  couriers: SolverInvocationCourier[];
  optimization_weights: SolverInvocationWeights;
  solver_settings?: SolverInvocationSettings;
}

export interface SolverInvocationRequest {
  inputs: Array<{
    data: SolverInvocationData & Record<string, unknown>;
  }>;
}

export interface SolverInputPayload {
  request: SolverInvocationRequest;
  tau: number[][];
  order_created_offset: number[];
  order_ready_offset: number[];
  courier_available_offset: number[];
  meta: SolverInputMeta;
}

export interface SolverDomainCourierStop {
  position: number;
  order_id: string;
}

export interface SolverDomainCourierPlan {
  courier_id: string;
  planned_departure_at_utc?: string | null;
  planned_return_at_utc?: string | null;
  delivery_sequence?: SolverDomainCourierStop[];
}

export interface SolverDomainOrderPlan {
  order_id: string;
  assigned_courier_id?: string | null;
  planned_delivery_at_utc?: string | null;
  is_cert?: boolean;
  is_skipped?: boolean;
}

export interface SolverDomainMetrics {
  total_orders?: number;
  assigned_orders?: number;
  total_couriers?: number;
  assigned_couriers?: number;
  objective_value?: number;
  cert_count?: number;
  skip_count?: number;
}

export interface SolverDomainResponse {
  status?: string;
  current_timestamp_utc?: string;
  couriers?: SolverDomainCourierPlan[];
  orders?: SolverDomainOrderPlan[];
  metrics?: SolverDomainMetrics;
  result?: SolverDomainResponse;
  predictions?: unknown;
  [key: string]: unknown;
}

export interface SolverMetricsSummary {
  totalOrders?: number;
  assignedOrders?: number;
  totalCouriers?: number;
  assignedCouriers?: number;
  objectiveValue?: number;
  certCount?: number;
  skipCount?: number;
}

export interface SolverRouteResult {
  route: number[];
  eta: number[];
}

export type SolverVector = number[] | Record<number, number>;

export interface SolverResult {
  routes: number[][];
  t_delivery?: SolverVector;
  t?: SolverVector;
  t_departure?: SolverVector;
  skip?: SolverVector;
  cert?: SolverVector;
  assigned_to_courier?: Record<string, number>;
  meta?: unknown;
}

export interface SolverInputResponse {
  input: SolverInputPayload;
  warnings: string[];
}

export interface OrdersComputedPatch {
  internalId: string;
  orderExternalId?: string;
  groupId?: number;
  routePos?: number;
  etaRelMin?: number;
  plannedC2eMin?: number;
  currentC2eMin?: number;
  courierWaitMin?: number;
  skip?: number;
  cert?: number;
  depotDirectMin?: number;
}

export interface RoutesSegmentDto {
  groupId: number;
  color: string;
  polyline: [number, number][];
  tooltip: string;
  courierId?: string;
  plannedDepartureRelMin?: number;
  plannedDepartureIso?: string;
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
  cpSatStatus?: string;
  cpSatMetrics?: SolverMetricsSummary | null;
  domainResponse?: SolverDomainResponse;
}

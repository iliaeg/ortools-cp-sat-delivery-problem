"""FastAPI entrypoints for the CP-SAT solver."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

from .domain_mapping import DomainSolveRequest, DomainToSolverMapper
from .solver import Solver


app = FastAPI()
_solver = Solver()


def _isoformat(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _minutes_to_iso(base: datetime, minutes: int) -> str:
    return _isoformat(base + timedelta(minutes=minutes))


def _format_domain_response(
    payload: DomainSolveRequest,
    problem: Dict[str, Any],
    solver_result: Dict[str, Any],
    metadata: Dict[str, Any],
) -> DomainSolveResponse:
    base_time = payload.current_timestamp_utc.astimezone(timezone.utc)
    tau: List[List[int]] = problem["tau"]

    order_ids: List[str] = metadata["order_ids"]
    courier_ids: List[str] = metadata["courier_ids"]
    index_to_order_id = {index: order_id for order_id, index in metadata["order_index_by_id"].items()}

    routes: List[List[int]] = solver_result.get("routes", [])
    t_departure: List[int] = solver_result.get("t_departure", [])
    t_delivery: Dict[int, int] = solver_result.get("t_delivery", {})
    cert_flags: Dict[int, int] = solver_result.get("cert", {})
    skip_flags: Dict[int, int] = solver_result.get("skip", {})

    order_assignments: Dict[str, str] = {}

    courier_plans: List[CourierPlan] = []
    assigned_couriers = 0

    for courier_idx, courier_id in enumerate(courier_ids):
        route = routes[courier_idx] if courier_idx < len(routes) else [0, 0]
        order_nodes = [node for node in route if node != 0]

        if order_nodes:
            assigned_couriers += 1
            departure_minutes = t_departure[courier_idx]
            planned_departure = _minutes_to_iso(base_time, departure_minutes)

            # compute return time by walking through the route
            total_minutes = departure_minutes
            prev_node = route[0]
            delivery_sequence: List[CourierStop] = []
            for position, node in enumerate(route[1:], start=1):
                travel = tau[prev_node][node]
                total_minutes += travel
                prev_node = node
                if node != 0:
                    order_id = index_to_order_id[node]
                    order_assignments[order_id] = courier_id
                    delivery_sequence.append(
                        CourierStop(position=position, order_id=order_id)
                    )
            planned_return = _minutes_to_iso(base_time, total_minutes)
        else:
            planned_departure = None
            planned_return = None
            delivery_sequence = []

        courier_plans.append(
            CourierPlan(
                courier_id=courier_id,
                planned_departure_at_utc=planned_departure,
                planned_return_at_utc=planned_return,
                delivery_sequence=delivery_sequence,
            )
        )

    order_plans: List[OrderPlan] = []
    assigned_orders = 0

    for order_id in order_ids:
        order_index = metadata["order_index_by_id"][order_id]
        skipped = bool(skip_flags.get(order_index, 0))
        assigned_courier_id = order_assignments.get(order_id)
        delivery_minutes = t_delivery.get(order_index)
        if not skipped and assigned_courier_id is not None and delivery_minutes is not None:
            assigned_orders += 1
            planned_delivery = _minutes_to_iso(base_time, delivery_minutes)
        else:
            planned_delivery = None
        order_plans.append(
            OrderPlan(
                order_id=order_id,
                assigned_courier_id=assigned_courier_id,
                planned_delivery_at_utc=planned_delivery,
                is_cert=bool(cert_flags.get(order_index, 0)),
                is_skipped=skipped,
            )
        )

    metrics = SolveMetrics(
        total_orders=len(order_ids),
        assigned_orders=assigned_orders,
        total_couriers=len(courier_ids),
        assigned_couriers=assigned_couriers,
        objective_value=int(solver_result.get("objective", 0)),
    )

    return DomainSolveResponse(
        status=solver_result.get("status", "UNKNOWN"),
        current_timestamp_utc=_isoformat(base_time),
        couriers=courier_plans,
        orders=order_plans,
        metrics=metrics,
    )


class SolveResponse(BaseModel):
    """Response schema wrapping the CP-SAT solver result."""

    result: Dict[str, Any]


class CourierStop(BaseModel):
    position: int
    order_id: str


class CourierPlan(BaseModel):
    courier_id: str
    planned_departure_at_utc: Optional[str]
    planned_return_at_utc: Optional[str]
    delivery_sequence: List[CourierStop]


class OrderPlan(BaseModel):
    order_id: str
    assigned_courier_id: Optional[str]
    planned_delivery_at_utc: Optional[str]
    is_cert: bool
    is_skipped: bool


class SolveMetrics(BaseModel):
    total_orders: int
    assigned_orders: int
    total_couriers: int
    assigned_couriers: int
    objective_value: int


class DomainSolveResponse(BaseModel):
    """High-level formatted solver response for the domain endpoint."""

    status: str
    current_timestamp_utc: str
    couriers: List[CourierPlan]
    orders: List[OrderPlan]
    metrics: SolveMetrics


@app.post("/solve-internal", response_model=SolveResponse)
def solve_internal(problem: Dict[str, Any]) -> SolveResponse:
    """Solve a low-level problem definition using the CP-SAT solver."""
    result = _solver.solve(problem)
    return SolveResponse(result=result)


@app.post("/solve", response_model=DomainSolveResponse)
def solve_domain_payload(payload: DomainSolveRequest) -> DomainSolveResponse:
    """Translate a domain payload into solver input and run the optimization."""
    mapper = DomainToSolverMapper(payload)
    problem = mapper.build_problem()
    result = _solver.solve(problem)
    metadata = mapper.build_metadata()
    return _format_domain_response(payload, problem, result, metadata)

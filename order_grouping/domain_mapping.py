from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


def _ensure_utc(dt: datetime) -> datetime:
    """Return a timezone-aware datetime in UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_iso_datetime(value: Any) -> datetime:
    """Parse ISO8601-like timestamps, allowing a trailing 'Z'."""
    if isinstance(value, datetime):
        return _ensure_utc(value)
    if isinstance(value, str):
        normalized = value.replace("z", "Z")
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        parsed = datetime.fromisoformat(normalized)
        return _ensure_utc(parsed)
    raise TypeError("Unsupported datetime value type")


def _minutes_between(reference: datetime, target: datetime) -> int:
    """Convert the delta between two timestamps into rounded integer minutes."""
    delta = target - reference
    return int(round(delta.total_seconds() / 60))


class DeliveryOrder(BaseModel):
    """Domain-facing payload describing a single delivery order."""

    order_id: str = Field(..., description="Уникальный идентификатор заказа")
    boxes_count: int = Field(..., ge=1, description="Число коробок в заказе")
    created_at_utc: datetime = Field(..., description="UTC-время создания заказа")
    expected_ready_at_utc: datetime = Field(..., description="Ожидаемое время готовности (UTC)")
    @field_validator("created_at_utc", "expected_ready_at_utc", mode="before")
    @classmethod
    def _parse_datetime(cls, value: Any) -> datetime:
        return _parse_iso_datetime(value)

class CourierShift(BaseModel):
    """Domain-facing payload describing a courier."""

    courier_id: str = Field(..., description="Идентификатор курьера")
    box_capacity: int = Field(..., ge=1, description="Максимальное число коробок на поездку")
    expected_courier_return_at_utc: datetime = Field(
        ..., description="Ожидаемое время, когда курьер доступен в пиццерии (UTC)"
    )

    @field_validator("expected_courier_return_at_utc", mode="before")
    @classmethod
    def _parse_datetime(cls, value: Any) -> datetime:
        return _parse_iso_datetime(value)


class OptimizationWeights(BaseModel):
    """Weights controlling the objective function components."""

    certificate_penalty_weight: int = Field(..., ge=0, description="Штраф за click-to-eat > 60 минут")
    click_to_eat_penalty_weight: int = Field(..., ge=0, description="Вес click-to-eat в целевой функции")
    skip_order_penalty_weight: Optional[int] = Field(
        None, ge=0, description="Штраф за временный пропуск заказа (по умолчанию как сертификат)"
    )


class SolverSettings(BaseModel):
    """Optional solver parameters exposed to the API."""

    time_limit_seconds: Optional[float] = Field(None, gt=0)
    max_parallel_workers: Optional[int] = Field(None, ge=1)
    max_route_arcs_per_courier: Optional[int] = Field(None, ge=1)


class DomainSolveRequest(BaseModel):
    """Entry payload for the domain-oriented `/solve` endpoint."""

    current_timestamp_utc: datetime = Field(
        ..., description="Текущий момент времени (UTC), принимаемый за точку отсчёта"
    )
    travel_time_matrix_minutes: List[List[int]] = Field(
        ..., description="Прогноз времени пути (tau) в минутах: [депо + заказы]"
    )
    orders: List[DeliveryOrder]
    couriers: List[CourierShift]
    optimization_weights: OptimizationWeights
    solver_settings: Optional[SolverSettings] = None

    @field_validator("current_timestamp_utc", mode="before")
    @classmethod
    def _parse_datetime(cls, value: Any) -> datetime:
        return _parse_iso_datetime(value)

    @model_validator(mode="after")
    def _validate_consistency(self) -> "DomainSolveRequest":
        matrix_size = len(self.travel_time_matrix_minutes)
        expected_size = len(self.orders) + 1
        if matrix_size != expected_size:
            msg = (
                "travel_time_matrix_minutes must have N+1 rows (depot + orders). "
                f"Got {matrix_size}, expected {expected_size}."
            )
            raise ValueError(msg)
        for row in self.travel_time_matrix_minutes:
            if len(row) != expected_size:
                msg = (
                    "travel_time_matrix_minutes must be a square matrix of size N+1. "
                    f"Got row of length {len(row)}, expected {expected_size}."
                )
                raise ValueError(msg)
        if len(self.couriers) == 0:
            raise ValueError("At least one courier must be provided")
        if len(self.orders) == 0:
            raise ValueError("At least one order must be provided")
        return self


class DomainToSolverMapper:
    """Helper translating domain payloads into solver inputs."""

    def __init__(self, payload: DomainSolveRequest) -> None:
        self._payload = payload

    def build_problem(self) -> Dict[str, Any]:
        ref = self._payload.current_timestamp_utc
        orders = self._payload.orders
        couriers = self._payload.couriers

        solver_problem: Dict[str, Any] = {
            "tau": self._payload.travel_time_matrix_minutes,
            "K": len(couriers),
            "C": [courier.box_capacity for courier in couriers],
            "box": [order.boxes_count for order in orders],
            "c": [_minutes_between(ref, order.created_at_utc) for order in orders],
            "r": [_minutes_between(ref, order.expected_ready_at_utc) for order in orders],
            "a": [
                _minutes_between(ref, courier.expected_courier_return_at_utc) for courier in couriers
            ],
            "W_cert": self._payload.optimization_weights.certificate_penalty_weight,
            "W_c2e": self._payload.optimization_weights.click_to_eat_penalty_weight,
        }

        skip_weight = self._payload.optimization_weights.skip_order_penalty_weight
        if skip_weight is not None:
            solver_problem["W_skip"] = skip_weight

        settings = self._payload.solver_settings
        if settings and settings.time_limit_seconds is not None:
            solver_problem["time_limit"] = settings.time_limit_seconds
        if settings and settings.max_parallel_workers is not None:
            solver_problem["workers"] = settings.max_parallel_workers
        if settings and settings.max_route_arcs_per_courier is not None:
            solver_problem["max_route_arcs_per_courier"] = settings.max_route_arcs_per_courier

        return solver_problem

    def build_metadata(self) -> Dict[str, Any]:
        """Expose useful lookup tables for the caller (order id <-> index)."""
        order_ids = [order.order_id for order in self._payload.orders]
        courier_ids = [courier.courier_id for courier in self._payload.couriers]
        return {
            "order_index_by_id": {order_id: idx + 1 for idx, order_id in enumerate(order_ids)},
            "order_ids": order_ids,
            "courier_ids": courier_ids,
        }


def map_domain_request(payload: DomainSolveRequest) -> Dict[str, Any]:
    """Convenience helper to build a solver problem from a domain payload."""
    return DomainToSolverMapper(payload).build_problem()


__all__ = [
    "CourierShift",
    "DeliveryOrder",
    "DomainSolveRequest",
    "DomainToSolverMapper",
    "map_domain_request",
    "OptimizationWeights",
    "SolverSettings",
]

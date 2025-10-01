"""CP-SAT solver wrapper utilities."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Any

from ortools.sat.python import cp_model
from pydantic import BaseModel, Field, field_validator, model_validator

from order_grouping.cp_sat_model import build_cp_sat_model

class Courier(BaseModel):
    """Single courier parameters used by the CP-SAT model."""

    id: str
    isReady: bool
    forecast_arrival_at_utc: Optional[str] = None

class Order(BaseModel):
    """Single order parameters used by the CP-SAT model."""

    id: str
    created_at_utc: str
    prep_duration_left_minutes: int = Field(ge=0)

    @field_validator("created_at_utc")
    @classmethod
    def ensure_hhmmss(cls, value: str) -> str:
        try:
            datetime.strptime(value, "%H:%M:%S")
        except ValueError as exc:  # pragma: no cover - safety path
            msg = "created_at_utc must be formatted as HH:MM:SS"
            raise ValueError(msg) from exc
        return value


class TravelTimeMatrix(BaseModel):
    """Square matrix (minutes) between kitchen (index 0) and order nodes."""

    matrix: List[List[int]]

    @field_validator("matrix")
    @classmethod
    def ensure_square(cls, value: List[List[int]]) -> List[List[int]]:
        if not value:
            msg = "travel_time matrix must not be empty"
            raise ValueError(msg)
        size = len(value)
        for row in value:
            if len(row) != size:
                msg = "travel_time matrix must be square"
                raise ValueError(msg)
        return value


class PenaltySettings(BaseModel):
    """Penalty configuration for the delivery optimization."""

    late_threshold_minutes: int = 60
    late_penalty: int = 1000
    c2e_penalty_per_minute: int = 10


def _created_at_minutes(order: Order) -> int:
    """Convert HH:MM:SS created_at_utc to minutes since midnight."""

    return _hhmmss_to_minutes(order.created_at_utc)


def _hhmmss_to_minutes(value: str) -> int:
    timestamp = datetime.strptime(value, "%H:%M:%S")
    total_seconds = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
    return total_seconds // 60

class CPData(BaseModel):
    """Input payload for CP-SAT solver. Extend with actual parameters later."""
    couriers: List[Courier]
    current_time_utc: str = "00:00:00"
    orders: List[Order]
    travel_time: TravelTimeMatrix
    penalty: PenaltySettings = Field(default_factory=PenaltySettings)

    @model_validator(mode="after")
    def validate_matrix_dimensions(self) -> "CPData":
        expected = len(self.orders) + 1
        matrix_size = len(self.travel_time.matrix)
        if matrix_size != expected:
            msg = (
                "travel_time matrix must be (orders + kitchen) sized. "
                f"Expected {expected}, got {matrix_size}."
            )
            raise ValueError(msg)
        return self


class CPResult(BaseModel):
    """Structured response with solver status, objective, and variable values."""

    status: str
    objective_value: int
    variables: dict[str, int]


def solve_cp_sat(data: CPData) -> dict[str, Any]: #CPResult:
    """Solve the sample CP-SAT optimization problem from Google OR-Tools docs."""
    _ = data  # placeholder to keep signature compatible for future parameters

    # Пока заглушили метод, чтобы не тратить время на обработку выходного значения
    return build_cp_sat_model(data)

    # artifacts = build_cp_sat_model(data)

    # solver = cp_model.CpSolver()
    # status_code = solver.Solve(artifacts.model)

    # return CPResult(
    #     status=solver.StatusName(status_code),
    #     objective_value=int(solver.ObjectiveValue()),
    #     variables={
    #         # "x": solver.Value(artifacts.x),
    #         # "y": solver.Value(artifacts.y),
    #         # "z": solver.Value(artifacts.z),
    #     },
    # )

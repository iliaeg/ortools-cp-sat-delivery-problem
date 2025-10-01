"""FastAPI entrypoints for CP-SAT solver."""

from pathlib import Path
import importlib.util
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any

from .solver import CPData, CPResult, solve_cp_sat


def _load_gpt_solver() -> Any:
    """Dynamically import Solver from solver-gpt module."""
    module_path = Path(__file__).with_name("solver-gpt.py")
    spec = importlib.util.spec_from_file_location(
        "order_grouping.solver_gpt", module_path
    )
    if spec is None or spec.loader is None:  # pragma: no cover - defensive branch
        msg = "Failed to load solver-gpt module"
        raise ImportError(msg)

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module.Solver()

app = FastAPI()
_gpt_solver = _load_gpt_solver()


class SolveResponse(BaseModel):
    """Response schema wrapping the CP-SAT solver result."""

    # Пока заглушили выходной тип, чтобы не тратить время на обработку выходного значения
    result: dict[str, Any] #CPResult


@app.post("/solve-gpt", response_model=SolveResponse)
def solve_with_gpt_solver(problem: dict[str, Any]) -> SolveResponse:
    """Invoke the GPT solver implementation."""
    result = _gpt_solver.solve(problem)
    return SolveResponse(result=result)


@app.post("/solve/v2", response_model=SolveResponse)
def solve(data: CPData) -> SolveResponse:
    """Invoke the CP-SAT solver wrapper."""
    result = solve_cp_sat(data)
    return SolveResponse(result=result)

"""FastAPI entrypoints for CP-SAT solver."""

from pathlib import Path
import importlib.util
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any

def _load_solver_extension() -> Any:
    """Dynamically import Solver implementation from the extension module."""
    module_path = Path(__file__).with_name("solver.py")
    spec = importlib.util.spec_from_file_location(
        "order_grouping.solver", module_path
    )
    if spec is None or spec.loader is None:  # pragma: no cover - defensive branch
        msg = "Failed to load solver extension module"
        raise ImportError(msg)

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module.Solver()

app = FastAPI()
_extension_solver = _load_solver_extension()


class SolveResponse(BaseModel):
    """Response schema wrapping the CP-SAT solver result."""

    # Пока заглушили выходной тип, чтобы не тратить время на обработку выходного значения
    result: dict[str, Any]


@app.post("/solve", response_model=SolveResponse)
def solve_with_extension_solver(problem: dict[str, Any]) -> SolveResponse:
    """Invoke the dynamically loaded solver implementation."""
    result = _extension_solver.solve(problem)
    return SolveResponse(result=result)

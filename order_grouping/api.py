"""FastAPI entrypoints for the CP-SAT solver."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI
from pydantic import BaseModel

from .domain_mapping import DomainSolveRequest, DomainToSolverMapper


def _load_solver_extension() -> Any:
    """Dynamically import Solver implementation from the extension module."""
    module_path = Path(__file__).with_name("solver.py")
    spec = importlib.util.spec_from_file_location("order_grouping.solver", module_path)
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

    result: Dict[str, Any]


class DomainSolveMetadata(BaseModel):
    """Useful lookup tables accompanying the domain endpoint."""

    order_ids: list[str]
    courier_ids: list[str]
    order_index_by_id: Dict[str, int]


class DomainSolveResponse(BaseModel):
    """Response for the domain-oriented endpoint, with solver result and metadata."""

    result: Dict[str, Any]
    meta: DomainSolveMetadata


@app.post("/solve", response_model=SolveResponse)
def solve_with_extension_solver(problem: Dict[str, Any]) -> SolveResponse:
    """Invoke the dynamically loaded solver implementation."""
    result = _extension_solver.solve(problem)
    return SolveResponse(result=result)


@app.post("/solve-domain", response_model=DomainSolveResponse)
def solve_from_domain_payload(payload: DomainSolveRequest) -> DomainSolveResponse:
    """Translate a domain payload into solver input and run the optimization."""
    mapper = DomainToSolverMapper(payload)
    problem = mapper.build_problem()
    result = _extension_solver.solve(problem)
    metadata = mapper.build_metadata()
    return DomainSolveResponse(result=result, meta=DomainSolveMetadata(**metadata))

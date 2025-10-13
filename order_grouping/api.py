"""FastAPI entrypoints for the CP-SAT solver."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import FastAPI
from pydantic import BaseModel

from .domain_mapping import DomainSolveRequest, DomainToSolverMapper
from .solver import Solver


app = FastAPI()
_solver = Solver()


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
    return DomainSolveResponse(result=result, meta=DomainSolveMetadata(**metadata))

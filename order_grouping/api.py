"""FastAPI entrypoints for CP-SAT solver."""

from fastapi import FastAPI
from pydantic import BaseModel

from .solver import CPData, CPResult, solve_cp_sat

app = FastAPI()


class SolveResponse(BaseModel):
    """Response schema wrapping the CP-SAT solver result."""

    result: CPResult


@app.post("/solve", response_model=SolveResponse)
def solve(data: CPData) -> SolveResponse:
    """Invoke the CP-SAT solver wrapper."""
    result = solve_cp_sat(data)
    return SolveResponse(result=result)

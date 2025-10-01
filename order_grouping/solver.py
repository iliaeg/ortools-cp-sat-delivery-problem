"""CP-SAT solver wrapper utilities."""

from ortools.sat.python import cp_model
from pydantic import BaseModel


class CPData(BaseModel):
    """Input payload for CP-SAT solver. Extend with actual parameters later."""
    pass


class CPResult(BaseModel):
    """Structured response with solver status, objective, and variable values."""

    status: str
    objective_value: int
    variables: dict[str, int]


def solve_cp_sat(data: CPData) -> CPResult:
    """Solve the sample CP-SAT optimization problem from Google OR-Tools docs."""
    _ = data  # placeholder to keep signature compatible for future parameters

    model = cp_model.CpModel()

    x = model.NewBoolVar("x")
    y = model.NewBoolVar("y")
    z = model.NewBoolVar("z")

    model.Add(x + 2 * y + 3 * z <= 4)
    model.Maximize(x + 2 * y + 3 * z)

    solver = cp_model.CpSolver()
    status_code = solver.Solve(model)

    return CPResult(
        status=solver.StatusName(status_code),
        objective_value=int(solver.ObjectiveValue()),
        variables={
            "x": solver.Value(x),
            "y": solver.Value(y),
            "z": solver.Value(z),
        },
    )

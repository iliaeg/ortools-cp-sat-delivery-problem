from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from order_grouping.api import app
from order_grouping.solver import CPData, solve_cp_sat


def test_solve_cp_sat_solves_sample_problem():
    result = solve_cp_sat(CPData())

    assert result.status == "OPTIMAL"
    assert result.objective_value == 4
    assert result.variables == {"x": 1, "y": 0, "z": 1}


def test_api_returns_serializable_result():
    client = TestClient(app)

    response = client.post("/solve", json={})

    assert response.status_code == 200
    assert response.json() == {
        "result": {
            "status": "OPTIMAL",
            "objective_value": 4,
            "variables": {"x": 1, "y": 0, "z": 1},
        }
    }

from __future__ import annotations

from pathlib import Path
import sys
import importlib.util

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

_SOLVER_PATH = Path(__file__).resolve().parents[1] / "order_grouping" / "solver-gpt.py"
_SOLVER_SPEC = importlib.util.spec_from_file_location("solver_gpt_module", _SOLVER_PATH)
_SOLVER_MODULE = importlib.util.module_from_spec(_SOLVER_SPEC)
assert _SOLVER_SPEC and _SOLVER_SPEC.loader
_SOLVER_SPEC.loader.exec_module(_SOLVER_MODULE)
Solver = _SOLVER_MODULE.Solver


class TestSolverGPT:
    @staticmethod
    def _solve(problem: dict) -> dict:
        return Solver().solve(problem)

    def test_tc_001_basic_sanity(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 10], [10, 0]],
                "K": 1,
                "C": [10],
                "box": [1],
                "c": [0],
                "r": [0],
                "a": [0],
                "W_cert": 100,
                "W_c2e": 1,
                "W_skip": 1000,
            }
        )

        assert result["status"] == "OPTIMAL"
        assert result["routes"] == [[0, 1, 0]]
        assert result["T"][1] == 10
        assert result["s"][1] == 0
        assert result["skip"][1] == 0
        assert result["objective"] == 10

    def test_tc_002_route_order_minimizes_sum_t_minus_c(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 10, 20], [10, 0, 5], [20, 5, 0]],
                "K": 1,
                "C": [10],
                "box": [1, 1],
                "c": [0, 0],
                "r": [0, 0],
                "a": [0],
                "W_cert": 100,
                "W_c2e": 1,
                "W_skip": 1000,
            }
        )

        assert result["routes"] == [[0, 1, 2, 0]]
        assert result["T"][1] == 10
        assert result["T"][2] == 15
        assert result["s"] == {1: 0, 2: 0}
        assert result["skip"] == {1: 0, 2: 0}
        assert result["objective"] == 25

    def test_tc_003_reordering_avoids_certificates(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 50, 20], [50, 0, 20], [20, 50, 0]],
                "K": 1,
                "C": [10],
                "box": [1, 1],
                "c": [30, 0],
                "r": [0, 0],
                "a": [0],
                "W_cert": 100,
                "W_c2e": 1,
                "W_skip": 1000,
            }
        )

        assert result["routes"] == [[0, 2, 1, 0]]
        assert result["T"][2] == 20
        assert result["T"][1] == 70
        assert result["s"] == {1: 0, 2: 0}
        assert result["skip"] == {1: 0, 2: 0}
        assert result["objective"] == 60

    def test_tc_004_capacity_forces_single_assignment(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 5, 5], [5, 0, 5], [5, 5, 0]],
                "K": 1,
                "C": [1],
                "box": [1, 1],
                "c": [0, 0],
                "r": [0, 0],
                "a": [0],
                "W_cert": 100,
                "W_c2e": 1,
                "W_skip": 1,
            }
        )

        assert sum(result["skip"].values()) == 1
        assigned = [i for i, skipped in result["skip"].items() if skipped == 0]
        assert assigned == [result["routes"][0][1]]
        assert result["routes"][0] in ([0, 1, 0], [0, 2, 0])
        assert all(result["s"][i] == 0 for i in (1, 2))
        assert result["objective"] == 6

    def test_tc_005_skip_cheaper_than_certificate(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 70, 5], [70, 0, 70], [5, 70, 0]],
                "K": 1,
                "C": [10],
                "box": [1, 1],
                "c": [0, 0],
                "r": [0, 0],
                "a": [0],
                "W_cert": 1000,
                "W_c2e": 1,
                "W_skip": 100,
            }
        )

        assert result["routes"] == [[0, 2, 0]]
        assert result["skip"] == {1: 1, 2: 0}
        assert result["s"] == {1: 0, 2: 0}
        assert result["T"][2] == 5
        assert result["objective"] == 105

    def test_tc_006_certificate_preferred_over_expensive_skip(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 70, 5], [70, 0, 70], [5, 70, 0]],
                "K": 1,
                "C": [10],
                "box": [1, 1],
                "c": [0, 0],
                "r": [0, 0],
                "a": [0],
                "W_cert": 1000,
                "W_c2e": 1,
                "W_skip": 2000,
            }
        )

        assert result["routes"] == [[0, 2, 1, 0]]
        assert result["skip"] == {1: 0, 2: 0}
        assert result["s"] == {1: 1, 2: 0}
        assert result["T"][2] == 5
        assert result["T"][1] == 75
        assert result["objective"] == 1080

    def test_tc_007_readiness_delays_departure(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 10, 10], [10, 0, 10], [10, 10, 0]],
                "K": 1,
                "C": [3],
                "box": [1, 1],
                "c": [0, 0],
                "r": [30, 0],
                "a": [0],
                "W_cert": 100,
                "W_c2e": 1,
                "W_skip": 1000,
            }
        )

        assert result["t_dep"][0] == 30
        assert sorted(result["T"].values()) == [40, 50]
        assert result["objective"] == 90
        assert result["skip"] == {1: 0, 2: 0}
        assert result["s"] == {1: 0, 2: 0}
        assert set(result["routes"][0][1:-1]) == {1, 2}

    def test_tc_008_assign_to_earliest_available_courier(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 10, 10], [10, 0, 10], [10, 10, 0]],
                "K": 2,
                "C": [10, 10],
                "box": [1, 1],
                "c": [0, 0],
                "r": [0, 0],
                "a": [0, 100],
                "W_cert": 100,
                "W_c2e": 1,
                "W_skip": 1000,
            }
        )

        assert set(result["routes"][0][1:-1]) == {1, 2}
        assert result["routes"][1] == [0, 0]
        assert result["skip"] == {1: 0, 2: 0}
        assert all(result["z"][(i, 0)] == 1 for i in (1, 2))
        assert all(result["z"][(i, 1)] == 0 for i in (1, 2))
        assert result["objective"] == 30
        assert result["t_dep"] == [0, 100]

    def test_tc_009_zero_certificate_weight_prioritizes_travel_time(self) -> None:
        result = self._solve(
            {
                "tau": [
                    [0, 30, 10, 10],
                    [30, 0, 5, 50],
                    [10, 5, 0, 5],
                    [10, 50, 5, 0],
                ],
                "K": 1,
                "C": [10],
                "box": [1, 1, 1],
                "c": [0, 0, 0],
                "r": [0, 0, 0],
                "a": [0],
                "W_cert": 0,
                "W_c2e": 1,
                "W_skip": 1000,
            }
        )

        assert result["routes"] == [[0, 3, 2, 1, 0]]
        assert result["skip"] == {1: 0, 2: 0, 3: 0}
        assert result["s"] == {1: 0, 2: 0, 3: 0}
        assert result["T"][3] == 10
        assert result["T"][2] == 15
        assert result["T"][1] == 20
        assert result["objective"] == 45

    def test_tc_010_zero_capacity_skips_everything(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 5, 5], [5, 0, 5], [5, 5, 0]],
                "K": 1,
                "C": [0],
                "box": [1, 1],
                "c": [0, 0],
                "r": [0, 0],
                "a": [0],
                "W_cert": 100,
                "W_c2e": 1,
                "W_skip": 1,
            }
        )

        assert result["routes"] == [[0, 0]]
        assert result["skip"] == {1: 1, 2: 1}
        assert result["z"] == {(1, 0): 0, (2, 0): 0}
        assert result["objective"] == 2
        assert result["T"] == {1: 0, 2: 0}

    def test_tc_011_skip_distant_order_with_moderate_penalty(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 5, 60], [5, 0, 60], [60, 60, 0]],
                "K": 1,
                "C": [1],
                "box": [1, 1],
                "c": [0, 0],
                "r": [0, 0],
                "a": [0],
                "W_cert": 200,
                "W_c2e": 1,
                "W_skip": 50,
            }
        )

        assert result["routes"] == [[0, 1, 0]]
        assert result["skip"] == {1: 0, 2: 1}
        assert result["s"] == {1: 0, 2: 0}
        assert result["T"][1] == 5
        assert result["objective"] == 55

    def test_tc_012_high_certificate_weight_reinforces_reordering(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 50, 20], [50, 0, 20], [20, 50, 0]],
                "K": 1,
                "C": [10],
                "box": [1, 1],
                "c": [30, 0],
                "r": [0, 0],
                "a": [0],
                "W_cert": 10000,
                "W_c2e": 1,
                "W_skip": 1000,
            }
        )

        assert result["routes"] == [[0, 2, 1, 0]]
        assert result["skip"] == {1: 0, 2: 0}
        assert result["s"] == {1: 0, 2: 0}
        assert result["objective"] == 60

    def test_tc_013_old_order_vs_cheap_skip(self) -> None:
        result = self._solve(
            {
                "tau": [[0, 5], [5, 0]],
                "K": 1,
                "C": [1],
                "box": [1],
                "c": [-120],
                "r": [0],
                "a": [0],
                "W_cert": 100,
                "W_c2e": 1,
                "W_skip": 1,
            }
        )

        assert result["routes"] == [[0, 0]]
        assert result["skip"] == {1: 1}
        assert result["s"] == {1: 1}
        assert result["T"][1] == 0
        assert result["objective"] == 221

    def test_tc_014_invalid_tau_raises(self) -> None:
        with pytest.raises(AssertionError):
            self._solve(
                {
                    "tau": [[0, 1], [1, 0], [1, 1]],
                    "K": 1,
                    "C": [10],
                    "box": [1],
                    "c": [0],
                    "r": [0],
                    "a": [0],
                    "W_cert": 100,
                    "W_c2e": 1,
                }
            )

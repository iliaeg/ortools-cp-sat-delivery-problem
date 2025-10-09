from __future__ import annotations

from pathlib import Path
import sys
import importlib.util

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

_SOLVER_PATH = Path(__file__).resolve().parents[1] / "order_grouping" / "solver.py"
_SOLVER_SPEC = importlib.util.spec_from_file_location("solver_extension_module", _SOLVER_PATH)
_SOLVER_MODULE = importlib.util.module_from_spec(_SOLVER_SPEC)
assert _SOLVER_SPEC and _SOLVER_SPEC.loader
_SOLVER_SPEC.loader.exec_module(_SOLVER_MODULE)
Solver = _SOLVER_MODULE.Solver


class TestSolverExtension:
    @staticmethod
    def _solve(problem: dict) -> dict:
        return Solver().solve(problem)

    def test_tc_001_basic_sanity(self) -> None:
        """TC-001 Базовый sanity: один заказ, пропуск невыгоден.

        Expected: status=OPTIMAL, route [0,1,0], T1=10, s1=0, skip1=0, objective=10.
        Notes: Пропуск дороже, потому что W_skip высокое.
        """
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
        """TC-002 Минимизируем сумму T−c выбором порядка 1→2.

        Expected: route [0,1,2,0], T1=10, T2=15, s=0, skip=0, objective=25.
        Notes: Порядок 1→2 лучше, чем 2→1 (35).
        """
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
        """TC-003 Перестановкой 2→1 избегаем сертификата.

        Expected: route [0,2,1,0], T2=20, T1=70, s=0, skip=0, objective=60.
        Notes: Если ехать 1→2, второй заказ попадает под сертификат.
        """
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
        """TC-004 Ёмкость 1: должен остаться ровно один назначенный заказ.

        Expected: один заказ назначен, второй skip; маршрут [0,i,0]; objective≈15.
        Notes: Ёмкости курьера хватает только на один заказ, пропуск обязателен.
        """
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
                "W_skip": 10,
            }
        )

        assert sum(result["skip"].values()) == 1
        assigned = [i for i, skipped in result["skip"].items() if skipped == 0]
        assert assigned == [result["routes"][0][1]]
        assert result["routes"][0] in ([0, 1, 0], [0, 2, 0])
        assert all(result["s"][i] == 0 for i in (1, 2))
        assert result["objective"] == 15

    def test_tc_005_skip_cheaper_than_certificate(self) -> None:
        """TC-005 Пропуск выигрывает у сертификата при умеренном штрафе.

        Expected: skip одного заказа (1 или 2), маршрут [0,2,0], objective≈W_skip+5.
        Notes: Любая поездка с двумя заказами ведёт к сертификату, поэтому выгодно пропустить.
        """
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
        """TC-006 Дорогой пропуск ⇒ едем, даже если ловим сертификат.

        Expected: оба заказа в маршруте [0,2,1,0]; один сертификат; skip=0.
        Notes: Большой W_skip делает пропуск ещё дороже, чем штраф за сертификат.
        """
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
        """TC-007 Готовность заказов задаёт выезд t_dep ≥ 30.

        Expected: t_dep=30, оба заказа в маршруте, T≈40 и 50, s=skip=0.
        Notes: Проверяем ограничение t_dep_k ≥ max(r_i назначенных).
        """
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
        """TC-008 Выбор курьера: все заказы у готового курьера 0.

        Expected: курьер 0 берёт оба заказа, курьер 1 простаивает, skip=0.
        Notes: Курьер 1 доступен слишком поздно (100 минут).
        """
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
        """TC-009 При W_cert=0 опт. порядок минимизирует Σ(T−c).

        Expected: маршрут [0,3,2,1,0], T3=10, T2=15, T1=20, s=0, skip=0.
        Notes: Очень низкий вес сертификата оставляет только travel-компонент
        (ставить вес сертификата в 0 нельзя, поскольку иначе решателю будет безразлично есть сертификат или нет
        и значения сертификата по заказам будут всегда разные).
        """
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
                "W_cert": 1,
                "W_c2e": 10,
                "W_skip": 10000,
            }
        )

        assert result["routes"] == [[0, 3, 2, 1, 0]]
        assert result["skip"] == {1: 0, 2: 0, 3: 0}
        assert result["s"] == {1: 0, 2: 0, 3: 0}
        assert result["T"][3] == 10
        assert result["T"][2] == 15
        assert result["T"][1] == 20
        assert result["objective"] == 450

    def test_tc_010_zero_capacity_skips_everything(self) -> None:
        """TC-010 Нулевая ёмкость ⇒ все заказы в skip.

        Expected: маршрут [0,0], skip={1:1,2:1}, objective=2*W_skip.
        Notes: Курьер не может взять ни одну коробку.
        """
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
        """TC-011 Пропуск «дальнего» заказа выгоднее сертификации.

        Expected: берём близкий заказ, skip для дальнего, objective≈5+W_skip.
        Notes: Даже при умеренном штрафе пропуск бьёт сумму travel+риск сертификата.
        """
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
        """TC-012 Высокий W_cert удерживает порядок без сертификатов.

        Expected: маршрут [0,2,1,0], s=0, skip=0, objective=60.
        Notes: Усиленный вес сертификата защищает решение TC-003 от регрессии.
        """
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
        """TC-013 Очень старый заказ выгоднее отложить при дешёвом skip.

        Expected: skip1=1, сертификат возможен, objective≈W_skip+|T-c|.
        Notes: Большое T-c делает пропуск предпочтительным.
        """
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
        """TC-014 Ошибка валидации входа.
        """
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

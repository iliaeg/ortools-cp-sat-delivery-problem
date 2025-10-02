"""Обработка и визуализация ответа CP-SAT солвера."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

from dateutil import parser

from map_orders.osrm_client import OsrmError, fetch_duration_matrix
from map_orders.state import AppState, MapPoint


@dataclass
class SolverOrderInfo:
    """Промежуточные данные для заказа из solver_result."""

    point: MapPoint
    index: int  # 1..N
    created_at_rel: Optional[int]


def apply_solver_result(app_state: AppState, payload: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    """Применяет solver_result к состоянию приложения.

    Возвращает кортеж (errors, warnings).
    """

    errors: List[str] = []
    warnings: List[str] = []

    if not isinstance(payload, dict):
        return ["Ответ солвера должен быть JSON-объектом"], warnings

    result = payload.get("result")
    if not isinstance(result, dict):
        return ["Ответ солвера должен содержать объект result"], warnings

    routes = result.get("routes")
    if not isinstance(routes, list):
        return ["result.routes должен быть массивом маршрутов"], warnings

    t_dep_raw = result.get("t_dep") or []
    if not isinstance(t_dep_raw, list):
        warnings.append("result.t_dep отсутствует или имеет некорректный формат; будет использован 0")
        t_dep_raw = []

    eta_map = _build_int_dict(result.get("T"))
    skip_map = _build_int_dict(result.get("skip"))
    cert_map = _build_int_dict(result.get("s"))

    # Сбрасываем solver-поля перед заполнением.
    for point in app_state.points:
        point.solver_group_id = None
        point.solver_route_pos = None
        point.solver_eta_rel_min = None
        point.solver_planned_c2e_min = None
        point.solver_skip = None
        point.solver_cert = None

    order_infos, depot_point = _collect_order_infos(app_state)
    if depot_point is None:
        errors.append("В таблице не найден depot")
        return errors, warnings
    if not order_infos:
        errors.append("Нет заказов для отображения")
        return errors, warnings

    tau_matrix: List[List[int]] | None = None
    try:
        tau_matrix = _ensure_tau_matrix(app_state)
    except (OsrmError, ValueError) as exc:
        warnings.append(f"Не удалось получить матрицу τ: {exc}")
        tau_matrix = None

    visited_orders: set[int] = set()
    for group_idx, route in enumerate(routes):
        if not isinstance(route, list):
            warnings.append(f"Маршрут группы #{group_idx} имеет некорректный формат и будет пропущен")
            continue
        orders_sequence = [int(node) for node in route if _is_positive_int(node)]
        if not orders_sequence:
            continue

        t_depart = int(t_dep_raw[group_idx]) if group_idx < len(t_dep_raw) and _is_number(t_dep_raw[group_idx]) else 0
        cumulative_eta: Optional[int] = t_depart
        prev_node = 0
        for position, node in enumerate(orders_sequence, start=1):
            info = order_infos.get(node)
            if info is None:
                warnings.append(
                    f"Маршрут группы #{group_idx}: узел {node} отсутствует среди заказов и будет пропущен"
                )
                prev_node = node
                cumulative_eta = None if cumulative_eta is None else cumulative_eta
                continue

            visited_orders.add(node)

            if skip_map.get(node) == 1:
                info.point.solver_skip = True
                info.point.solver_cert = bool(cert_map.get(node))
                continue

            seg_duration = _tau_value(tau_matrix, prev_node, node)
            if cumulative_eta is not None and seg_duration is not None:
                cumulative_eta = cumulative_eta + seg_duration
            else:
                cumulative_eta = None

            eta_value = eta_map.get(node)
            if eta_value is None and cumulative_eta is not None:
                eta_value = cumulative_eta
            if eta_value is not None:
                info.point.solver_eta_rel_min = int(eta_value)
            else:
                info.point.solver_eta_rel_min = None

            info.point.solver_group_id = group_idx
            info.point.solver_route_pos = position
            info.point.solver_skip = False
            info.point.solver_cert = bool(cert_map.get(node))

            if info.created_at_rel is not None and info.point.solver_eta_rel_min is not None:
                info.point.solver_planned_c2e_min = (
                    int(info.point.solver_eta_rel_min) - int(info.created_at_rel)
                )
            else:
                info.point.solver_planned_c2e_min = None

            if cumulative_eta is None and eta_value is not None:
                cumulative_eta = int(eta_value)

            prev_node = node

    # Отмечаем заказы, которые не были посещены в маршрутах.
    for index, info in order_infos.items():
        if info.point.solver_skip is True:
            continue
        if index not in visited_orders or skip_map.get(index) == 1:
            info.point.solver_group_id = None
            info.point.solver_route_pos = None
            info.point.solver_eta_rel_min = None
            info.point.solver_planned_c2e_min = None
            info.point.solver_skip = True
            info.point.solver_cert = bool(cert_map.get(index))

    app_state.solver_result = payload
    return errors, warnings


def reset_solver_result(app_state: AppState) -> None:
    """Сбрасывает solver-поля и результат солвера."""

    app_state.solver_result = None
    for point in app_state.points:
        point.solver_group_id = None
        point.solver_route_pos = None
        point.solver_eta_rel_min = None
        point.solver_planned_c2e_min = None
        point.solver_skip = None
        point.solver_cert = None


def _collect_order_infos(app_state: AppState) -> Tuple[Dict[int, SolverOrderInfo], MapPoint | None]:
    """Возвращает словарь индексов заказов и depot."""

    depot_point: MapPoint | None = None
    orders: Dict[int, SolverOrderInfo] = {}

    t0_iso = app_state.t0_iso
    for global_idx, point in enumerate(app_state.points):
        if point.type == "depot":
            depot_point = point
            continue
        order_index = len(orders) + 1
        created_rel = _minutes_from_iso(point.created_at, t0_iso)
        orders[order_index] = SolverOrderInfo(point=point, index=order_index, created_at_rel=created_rel)

    return orders, depot_point


def _ensure_tau_matrix(app_state: AppState) -> List[List[int]]:
    """Возвращает матрицу τ, при необходимости обновляя её."""

    expected_size = len(app_state.points)
    tau = app_state.last_tau
    if _is_valid_tau(tau, expected_size):
        return tau  # type: ignore[return-value]

    coordinates = [(point.lat, point.lon) for point in app_state.points]
    tau = fetch_duration_matrix(app_state.osrm_base_url, coordinates)
    if not _is_valid_tau(tau, expected_size):
        raise ValueError("OSRM вернул матрицу неподходящего размера")
    app_state.last_tau = tau
    return tau


def _is_valid_tau(tau: Any, expected_size: int) -> bool:
    """Проверяет, что τ имеет корректную размерность."""

    if not isinstance(tau, list) or len(tau) != expected_size:
        return False
    for row in tau:
        if not isinstance(row, list) or len(row) != expected_size:
            return False
    return True


def _tau_value(
    tau: Optional[List[List[int]]],
    from_node: int,
    to_node: int,
) -> Optional[int]:
    """Возвращает длительность от from_node к to_node или None."""

    if tau is None:
        return None
    if from_node < 0 or to_node < 0:
        return None
    try:
        value = tau[from_node][to_node]
    except (IndexError, TypeError):
        return None
    if not _is_number(value):
        return None
    return int(value)


def _minutes_from_iso(moment_iso: str | None, t0_iso: str | None) -> Optional[int]:
    """Возвращает минуты от T0 до moment_iso."""

    if not moment_iso or not t0_iso:
        return None
    try:
        moment = parser.isoparse(moment_iso)
        t0 = parser.isoparse(t0_iso)
    except (ValueError, TypeError):
        return None

    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.now(timezone.utc).tzinfo)
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=datetime.now(timezone.utc).tzinfo)

    moment_utc = moment.astimezone(timezone.utc)
    t0_utc = t0.astimezone(timezone.utc)
    delta = moment_utc - t0_utc
    return int(round(delta.total_seconds() / 60.0))


def _build_int_dict(data: Any) -> Dict[int, int]:
    """Преобразует словарь с ключами-строками в словарь с int."""

    if not isinstance(data, dict):
        return {}
    result: Dict[int, int] = {}
    for key, value in data.items():
        try:
            int_key = int(key)
            int_value = int(value)
        except (TypeError, ValueError):
            continue
        result[int_key] = int_value
    return result


def _is_positive_int(value: Any) -> bool:
    """Проверяет, что value описывает положительное целое число."""

    if isinstance(value, bool):
        return False
    try:
        number = int(value)
    except (TypeError, ValueError):
        return False
    return number > 0


def _is_number(value: Any) -> bool:
    """Проверяет, что value можно преобразовать к числу."""

    if isinstance(value, bool):
        return False
    return isinstance(value, (int, float)) and not math.isnan(float(value))

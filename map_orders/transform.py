"""Преобразования данных и подготовка входа для солвера."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import math
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from dateutil import parser


DEFAULT_WEIGHTS = {"W_cert": 1000, "W_c2e": 1, "W_skip": 200}


class ValidationError(ValueError):
    """Исключение, содержащее список ошибок валидации."""

    def __init__(self, errors: Sequence[str]):
        self.errors = list(errors)
        message = "; ".join(self.errors)
        super().__init__(message)


@dataclass
class NormalizedPoint:
    """Нормализованная точка (депо или заказ) после валидации."""

    id: str
    type: str
    lat: float
    lon: float
    boxes: int
    created_at: str
    ready_at: str
    extra_json_raw: str
    extra_json_obj: Dict[str, Any]
    extra_parse_error: bool


@dataclass
class PointsValidationResult:
    """Результат валидации точек из таблицы."""

    depot: Optional[NormalizedPoint]
    orders: List[NormalizedPoint]
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def coordinates_for_osrm(self) -> List[Tuple[float, float]]:
        """Возвращает список координат (lat, lon) для запроса OSRM."""

        coords: List[Tuple[float, float]] = []
        if self.depot is not None:
            coords.append((self.depot.lat, self.depot.lon))
        coords.extend((order.lat, order.lon) for order in self.orders)
        return coords

    def points_latlon(self) -> List[List[float]]:
        """Возвращает список [lat, lon] (депо + заказы) для метаданных."""

        result: List[List[float]] = []
        if self.depot is not None:
            result.append([self.depot.lat, self.depot.lon])
        result.extend([order.lat, order.lon] for order in self.orders)
        return result


@dataclass
class CourierParseResult:
    """Результат разбора couriers.json."""

    capacities: List[int]
    available_rel: List[int]
    meta_abstime: List[Dict[str, str]]
    raw_payload: Any
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


@dataclass
class WeightsParseResult:
    """Результат разбора weights.json."""

    weights: Dict[str, int]
    raw_payload: Any
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def parse_and_validate_points(raw_points: Iterable[Dict[str, Any]]) -> PointsValidationResult:
    """Парсит и валидирует точки из таблицы Streamlit."""

    errors: List[str] = []
    warnings: List[str] = []
    depot: Optional[NormalizedPoint] = None
    orders: List[NormalizedPoint] = []

    for idx, raw in enumerate(raw_points):
        label = _describe_point(raw, idx)
        point_type = str(raw.get("type") or "").strip().lower() or "order"
        if point_type not in {"depot", "order"}:
            errors.append(f"{label}: неизвестный тип '{raw.get('type')}'")
            continue

        try:
            lat = float(raw.get("lat"))
            lon = float(raw.get("lon"))
        except (TypeError, ValueError):
            errors.append(f"{label}: координаты lat/lon должны быть числами")
            continue
        if not (math.isfinite(lat) and math.isfinite(lon)):
            errors.append(f"{label}: координаты lat/lon должны быть конечными числами")
            continue
        if not (-90.0 <= lat <= 90.0):
            errors.append(f"{label}: широта должна быть в диапазоне [-90, 90]")
            continue
        if not (-180.0 <= lon <= 180.0):
            errors.append(f"{label}: долгота должна быть в диапазоне [-180, 180]")
            continue

        boxes_raw = raw.get("boxes", 0)
        try:
            boxes = int(boxes_raw)
        except (TypeError, ValueError):
            errors.append(f"{label}: количество коробок должно быть целым числом")
            continue
        if boxes < 0:
            errors.append(f"{label}: количество коробок должно быть ≥ 0")
            continue

        created_at = str(raw.get("created_at") or "").strip()
        ready_at = str(raw.get("ready_at") or "").strip()
        if not created_at:
            errors.append(f"{label}: заполните created_at в формате ISO 8601")
            continue
        if not ready_at:
            errors.append(f"{label}: заполните ready_at в формате ISO 8601")
            continue

        extra_raw = raw.get("extra_json")
        if isinstance(extra_raw, (dict, list)):
            extra_json_raw = json.dumps(extra_raw, ensure_ascii=False)
        else:
            extra_json_raw = str(extra_raw or "{}")

        extra_parse_error = False
        extra_obj: Dict[str, Any] = {}
        try:
            parsed = json.loads(extra_json_raw) if extra_json_raw else {}
            if parsed and not isinstance(parsed, dict):
                raise ValueError("extra_json должен быть JSON-объектом")
            extra_obj = parsed if isinstance(parsed, dict) else {}
        except (json.JSONDecodeError, ValueError):
            extra_parse_error = True
            warnings.append(
                f"{label}: extra_json не удалось распарсить; будет добавлен _extra_parse_error"
            )

        point = NormalizedPoint(
            id=str(raw.get("id") or _make_point_id(idx)),
            type=point_type,
            lat=lat,
            lon=lon,
            boxes=boxes,
            created_at=created_at,
            ready_at=ready_at,
            extra_json_raw=extra_json_raw,
            extra_json_obj=extra_obj,
            extra_parse_error=extra_parse_error,
        )

        if point_type == "depot":
            if depot is None:
                depot = point
            else:
                errors.append("Ровно один depot обязателен (найдено более одного)")
        else:
            orders.append(point)

    if depot is None:
        errors.append("Ровно один depot обязателен (найдено 0)")
    if not orders:
        errors.append("Нужен минимум один заказ (type=order)")

    return PointsValidationResult(depot=depot, orders=orders, errors=errors, warnings=warnings)


def make_solver_payload(
    points: PointsValidationResult,
    couriers_json: str,
    weights_json: str,
    additional_params_json: str,
    t0_iso: str,
    osrm_base_url: str,
    tau: List[List[int]],
) -> tuple[Dict[str, Any], List[str]]:
    """Собирает итоговый словарь для Solver.solve и возвращает его с предупреждениями."""

    errors = list(points.errors)
    warnings = list(points.warnings)

    if not t0_iso or not t0_iso.strip():
        errors.append("Укажите T0 в блоке слева")
        raise ValidationError(errors)

    try:
        t0_dt = _to_utc_datetime(t0_iso)
    except ValueError as exc:
        errors.append(f"T0: {exc}")
        raise ValidationError(errors)

    if points.depot is None or not points.orders:
        raise ValidationError(errors or ["Недостаточно точек для построения входа"])  # pragma: no cover

    expected_size = len(points.orders) + 1
    if len(tau) != expected_size or any(len(row) != expected_size for row in tau):
        errors.append("Матрица τ имеет некорректный размер")

    courier_data = _parse_couriers(couriers_json, t0_dt)
    weight_data = _parse_weights(weights_json)
    additional_params, additional_errors = _parse_additional_params(additional_params_json)

    errors.extend(courier_data.errors)
    warnings.extend(courier_data.warnings)
    errors.extend(weight_data.errors)
    warnings.extend(weight_data.warnings)
    errors.extend(additional_errors)

    if errors:
        raise ValidationError(errors)

    orders_created: List[int] = []
    orders_ready: List[int] = []
    orders_extra_meta: List[Dict[str, Any]] = []
    orders_abstime: List[Dict[str, str]] = []

    for order in points.orders:
        try:
            created_dt = _to_utc_datetime(order.created_at)
        except ValueError as exc:
            errors.append(f"Заказ {order.id}: created_at — {exc}")
            continue
        try:
            ready_dt = _to_utc_datetime(order.ready_at)
        except ValueError as exc:
            errors.append(f"Заказ {order.id}: ready_at — {exc}")
            continue

        created_rel = _minutes_delta(created_dt, t0_dt)
        ready_rel = _minutes_delta(ready_dt, t0_dt)

        if ready_rel < 0:
            errors.append(
                f"Заказ {order.id}: ready_at должен быть не раньше T0 (получилось {ready_rel} мин)"
            )

        orders_created.append(created_rel)
        orders_ready.append(ready_rel)
        orders_abstime.append({
            "created_at": order.created_at,
            "ready_at": order.ready_at,
        })

        if order.extra_parse_error:
            orders_extra_meta.append({"_extra_parse_error": True, "_raw": order.extra_json_raw})
        else:
            orders_extra_meta.append(order.extra_json_obj)

    if errors:
        raise ValidationError(errors)

    payload = {
        "tau": tau,
        "K": len(courier_data.capacities),
        "C": courier_data.capacities,
        "box": [order.boxes for order in points.orders],
        "c": orders_created,
        "r": orders_ready,
        "a": courier_data.available_rel,
        "W_cert": weight_data.weights["W_cert"],
        "W_c2e": weight_data.weights["W_c2e"],
        "W_skip": weight_data.weights["W_skip"],
        "meta": {
            "orders_extra": orders_extra_meta,
            "points_latlon": points.points_latlon(),
            "mode": "OSRM",
            "osrm_base_url": osrm_base_url,
            "T0_iso": t0_iso,
            "abstime": {
                "orders": orders_abstime,
                "couriers": courier_data.meta_abstime,
            },
        },
    }

    orders_snapshot: List[Dict[str, Any]] = [
        {
            "id": order.id,
            "type": order.type,
            "lat": order.lat,
            "lon": order.lon,
            "boxes": order.boxes,
            "created_at": order.created_at,
            "ready_at": order.ready_at,
            "extra_json": order.extra_json_raw,
        }
        for order in points.orders
    ]

    combined_params = dict(additional_params)
    combined_params["weights"] = weight_data.raw_payload
    combined_params["couriers"] = courier_data.raw_payload
    combined_params["orders"] = orders_snapshot
    if points.depot is not None:
        combined_params["depot"] = {
            "id": points.depot.id,
            "lat": points.depot.lat,
            "lon": points.depot.lon,
            "created_at": points.depot.created_at,
            "ready_at": points.depot.ready_at,
            "extra_json": points.depot.extra_json_raw,
        }

    payload["meta"]["combined_params"] = combined_params

    return payload, warnings


def _parse_couriers(couriers_json: str, t0_dt: datetime) -> CourierParseResult:
    """Парсит JSON курьеров и приводит время к относительным минутам."""

    errors: List[str] = []
    capacities: List[int] = []
    available_rel: List[int] = []
    meta_abstime: List[Dict[str, str]] = []
    raw_payload: Any = []

    text = couriers_json.strip() if couriers_json else ""
    try:
        payload = json.loads(text or "[]")
        raw_payload = payload
    except json.JSONDecodeError as exc:
        errors.append(f"couriers.json: {exc}")
        return CourierParseResult(
            capacities,
            available_rel,
            meta_abstime,
            raw_payload=text or couriers_json,
            errors=errors,
        )

    if isinstance(payload, dict):
        capacities_raw = payload.get("C") or payload.get("c")
        available_raw = payload.get("a")

        if not isinstance(capacities_raw, list) or not isinstance(available_raw, list):
            errors.append("couriers.json: ожидаются списки C и a")
            return CourierParseResult(
                capacities,
                available_rel,
                meta_abstime,
                raw_payload=payload,
                errors=errors,
            )

        if len(capacities_raw) != len(available_raw):
            errors.append("couriers.json: длины списков C и a должны совпадать")
            return CourierParseResult(
                capacities,
                available_rel,
                meta_abstime,
                raw_payload=payload,
                errors=errors,
            )

        for idx, (capacity_raw, available_raw_minutes) in enumerate(
            zip(capacities_raw, available_raw),
            start=1,
        ):
            try:
                capacity = int(capacity_raw)
            except (TypeError, ValueError):
                errors.append(f"Курьер #{idx}: capacity должен быть целым ≥ 0")
                continue
            if capacity < 0:
                errors.append(f"Курьер #{idx}: capacity должен быть целым ≥ 0")
                continue

            try:
                available_minutes = int(available_raw_minutes)
            except (TypeError, ValueError):
                errors.append(f"Курьер #{idx}: a должен быть целым числом минут")
                continue
            if available_minutes < 0:
                errors.append(f"Курьер #{idx}: a должен быть ≥ 0")
                continue

            capacities.append(capacity)
            available_rel.append(available_minutes)
            meta_abstime.append({"available_rel_minutes": str(available_minutes)})

        return CourierParseResult(capacities, available_rel, meta_abstime, raw_payload, errors=errors)

    if not isinstance(payload, list):
        errors.append("couriers.json должен быть массивом объектов или словарём с ключами a и C")
        return CourierParseResult(
            capacities,
            available_rel,
            meta_abstime,
            raw_payload=payload,
            errors=errors,
        )

    for idx, item in enumerate(payload, start=1):
        if not isinstance(item, dict):
            errors.append(f"Курьер #{idx}: должен быть объектом с полями capacity и available_at")
            continue

        capacity_raw = item.get("capacity")
        try:
            capacity = int(capacity_raw)
        except (TypeError, ValueError):
            errors.append(f"Курьер #{idx}: capacity должен быть целым ≥ 0")
            continue
        if capacity < 0:
            errors.append(f"Курьер #{idx}: capacity должен быть целым ≥ 0")
            continue

        available_at = item.get("available_at")
        if not available_at:
            errors.append(f"Курьер #{idx}: заполните available_at в ISO 8601")
            continue

        try:
            available_dt = _to_utc_datetime(str(available_at))
        except ValueError as exc:
            errors.append(f"Курьер #{idx}: available_at — {exc}")
            continue

        available_rel_minutes = _minutes_delta(available_dt, t0_dt)
        if available_rel_minutes < 0:
            errors.append(
                f"Курьер #{idx}: available_at должен быть не раньше T0 (получилось {available_rel_minutes} мин)"
            )
            continue

        capacities.append(capacity)
        available_rel.append(available_rel_minutes)
        meta_abstime.append({"available_at": str(available_at)})

    return CourierParseResult(capacities, available_rel, meta_abstime, raw_payload, errors=errors)


def _parse_weights(weights_json: str) -> WeightsParseResult:
    """Парсит JSON с весовыми коэффициентами."""

    errors: List[str] = []
    warnings: List[str] = []
    weights = DEFAULT_WEIGHTS.copy()
    raw_payload: Any = {}

    text = weights_json.strip() if weights_json else ""
    if not text:
        warnings.append("weights.json не задан — используются значения по умолчанию")
        return WeightsParseResult(weights, raw_payload, errors=errors, warnings=warnings)

    try:
        payload = json.loads(text)
        raw_payload = payload
    except json.JSONDecodeError as exc:
        errors.append(f"weights.json: {exc}")
        return WeightsParseResult(weights, text, errors=errors)

    if not isinstance(payload, dict):
        errors.append("weights.json должен быть объектом")
        return WeightsParseResult(weights, payload, errors=errors)

    for key in DEFAULT_WEIGHTS:
        if key not in payload:
            warnings.append(f"weights.json: не найден ключ {key}, используется значение по умолчанию")
            continue
        value = payload.get(key)
        try:
            value_int = int(value)
        except (TypeError, ValueError):
            errors.append(f"weights.json: {key} должен быть целым ≥ 0")
            continue
        if value_int < 0:
            errors.append(f"weights.json: {key} должен быть целым ≥ 0")
            continue
        weights[key] = value_int

    return WeightsParseResult(weights, payload, errors=errors, warnings=warnings)


def _parse_additional_params(additional_json: str) -> Tuple[Dict[str, Any], List[str]]:
    """Парсит JSON дополнительных параметров и гарантирует, что это объект."""

    errors: List[str] = []
    text = additional_json.strip() if additional_json else ""
    if not text:
        return {}, errors

    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        errors.append(f"additional_params.json: {exc}")
        return {}, errors

    if not isinstance(payload, dict):
        errors.append("additional_params.json должен быть объектом")
        return {}, errors

    return payload, errors


def _describe_point(raw: Dict[str, Any], idx: int) -> str:
    """Возвращает удобное текстовое описание точки для сообщений."""

    point_id = raw.get("id")
    if point_id:
        return f"Точка {point_id}"
    return f"Точка #{idx + 1}"


def _make_point_id(idx: int) -> str:
    """Формирует детерминированный ID при отсутствии в данных."""

    return f"p{idx + 1:03d}"


def _to_utc_datetime(value: str) -> datetime:
    """Парсит ISO-строку и приводит её к UTC."""

    if not value:
        raise ValueError("значение не задано")
    try:
        dt = parser.isoparse(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"некорректный формат даты/времени: {exc}") from exc
    if dt.tzinfo is None:
        local_tz = datetime.now().astimezone().tzinfo or timezone.utc
        dt = dt.replace(tzinfo=local_tz)
    return dt.astimezone(timezone.utc)


def _minutes_delta(moment: datetime, origin: datetime) -> int:
    """Возвращает разницу между moment и origin в минутах с округлением."""

    delta = moment - origin
    return int(round(delta.total_seconds() / 60.0))

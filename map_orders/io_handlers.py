"""Импорт и экспорт данных приложения."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Tuple

from .state import AppState, MapPoint


def export_geojson(app_state: AppState) -> Dict[str, Any]:
    """Возвращает актуальный GeoJSON FeatureCollection."""

    features: List[Dict[str, Any]] = []
    for point in app_state.points:
        properties: Dict[str, Any] = {
            "id": point.id,
            "type": point.type,
            "boxes": point.boxes,
            "created_at": point.created_at,
            "ready_at": point.ready_at,
        }

        extra_payload, parse_error = _load_extra_json(point.extra_json)
        properties["extra_json"] = extra_payload
        if parse_error:
            properties["_extra_parse_error"] = True
            properties["extra_json_raw"] = point.extra_json

        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [point.lon, point.lat],
                },
                "properties": properties,
            }
        )

    return {"type": "FeatureCollection", "features": features}


def export_case_bundle(app_state: AppState) -> Dict[str, Any]:
    """Возвращает кейс-бандл для восстановления состояния."""

    geojson = export_geojson(app_state)
    couriers = _safe_json_loads(app_state.couriers_json, default=[])
    weights = _safe_json_loads(app_state.weights_json, default={})
    additional_params = _safe_json_loads(app_state.additional_params_json, default={})

    bundle = {
        "t0_iso": app_state.t0_iso,
        "map_center": list(app_state.map_center),
        "map_zoom": app_state.map_zoom,
        "geojson": geojson,
        "couriers": couriers,
        "weights": weights,
        "additional_params": additional_params,
        "osrm_base_url": app_state.osrm_base_url,
    }
    return bundle


def import_case_bundle(app_state: AppState, payload: Dict[str, Any]) -> None:
    """Импортирует состояние из кейс-бандла."""

    if not isinstance(payload, dict):
        raise ValueError("Ожидался JSON-объект кейса")

    geojson = payload.get("geojson")
    if not isinstance(geojson, dict):
        raise ValueError("Поле geojson отсутствует или некорректно")
    features = geojson.get("features")
    if not isinstance(features, list):
        raise ValueError("GeoJSON должен содержать массив features")

    points: List[MapPoint] = []
    errors: List[str] = []
    for idx, feature in enumerate(features):
        if not isinstance(feature, dict):
            errors.append(f"Feature #{idx + 1}: некорректный формат")
            continue
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            errors.append(f"Feature #{idx + 1}: поддерживаются только точки")
            continue
        coords = geometry.get("coordinates") or []
        if not isinstance(coords, (list, tuple)) or len(coords) < 2:
            errors.append(f"Feature #{idx + 1}: отсутствуют координаты")
            continue
        lon, lat = coords[:2]
        props = feature.get("properties") or {}

        row = {
            "id": props.get("id"),
            "type": props.get("type"),
            "lat": lat,
            "lon": lon,
            "boxes": props.get("boxes"),
            "created_at": props.get("created_at"),
            "ready_at": props.get("ready_at"),
            "extra_json": props.get("extra_json"),
            "meta": {},
        }
        if props.get("_extra_parse_error") and props.get("extra_json_raw"):
            row["extra_json"] = props.get("extra_json_raw")

        try:
            point = MapPoint.from_row(row)
        except ValueError as exc:
            errors.append(f"Feature #{idx + 1}: {exc}")
            continue
        points.append(point)

    if errors:
        raise ValueError("; ".join(errors))

    app_state.points = points
    app_state.couriers_json = _dump_pretty_json(payload.get("couriers", []))
    app_state.weights_json = _dump_pretty_json(payload.get("weights", {}))
    app_state.additional_params_json = _dump_pretty_json(
        payload.get("additional_params", {"time_limit": 3.0})
    )
    app_state.osrm_base_url = str(payload.get("osrm_base_url") or app_state.osrm_base_url)

    map_center = payload.get("map_center")
    if isinstance(map_center, (list, tuple)) and len(map_center) >= 2:
        try:
            lat = float(map_center[0])
            lon = float(map_center[1])
            app_state.map_center = (lat, lon)
        except (TypeError, ValueError):  # pragma: no cover - защитная ветка
            pass

    map_zoom = payload.get("map_zoom")
    if isinstance(map_zoom, int) and 1 <= map_zoom <= 20:
        app_state.map_zoom = map_zoom

    t0_iso = payload.get("t0_iso")
    if isinstance(t0_iso, str) and t0_iso.strip():
        app_state.t0_iso = t0_iso.strip()


def _load_extra_json(value: str) -> Tuple[Dict[str, Any], bool]:
    """Пытается распарсить extra_json точки."""

    if not value:
        return {}, False
    try:
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed, False
        return {}, True
    except (TypeError, ValueError):
        return {}, True


def _safe_json_loads(text: str, default: Any) -> Any:
    """Возвращает распарсенный JSON или значение по умолчанию."""

    if not text:
        return default
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default


def _dump_pretty_json(obj: Any) -> str:
    """Возвращает JSON-строку с отступами."""

    return json.dumps(obj, ensure_ascii=False, indent=2)

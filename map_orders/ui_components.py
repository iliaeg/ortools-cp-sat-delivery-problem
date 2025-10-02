"""Компоненты Streamlit-интерфейса для приложения map_orders."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Optional, Tuple

import folium
from folium.plugins import Draw
import pandas as pd
import streamlit as st
from streamlit_folium import st_folium

from map_orders.osrm_client import OsrmError, fetch_duration_matrix
from map_orders.transform import (
    ValidationError,
    make_solver_payload,
    parse_and_validate_points,
)

from .state import AppState, MapPoint

_POINTS_EDITOR_KEY = "map_orders_points_editor"
_SOLVER_PAYLOAD_KEY = "map_orders_solver_payload"
_SOLVER_WARNINGS_KEY = "map_orders_solver_warnings"

def render_sidebar(app_state: AppState) -> None:
    """Отрисовывает боковую панель с основными параметрами."""

    with st.sidebar:
        st.header("map_orders — настройки")
        app_state.osrm_base_url = st.text_input(
            "OSRM base URL",
            value=app_state.osrm_base_url,
            help="Базовый URL локального OSRM (по умолчанию http://localhost:5000)",
        )

        st.subheader("Текущее время (T0)")
        t0_value = st.text_input(
            "T0 в ISO 8601",
            value=app_state.t0_iso or "",
            help="Используйте формат 2025-10-02T09:00:00+03:00",
        )
        if t0_value.strip():
            app_state.t0_iso = t0_value.strip()
        st.caption("Абсолютные времена будут переведены в минуты относительно T0")

        st.subheader("Курьеры (couriers.json)")
        app_state.couriers_json = st.text_area(
            "couriers.json",
            value=app_state.couriers_json,
            height=140,
            help="Массив с полями capacity и available_at",
        )

        st.subheader("Весовые коэффициенты")
        app_state.weights_json = st.text_area(
            "weights.json",
            value=app_state.weights_json,
            height=120,
            help="W_cert — штраф за сертификат, W_c2e — click-to-eat, W_skip — пропуск",
        )

        st.markdown(
            "*Подсказка:* сначала расставьте точки на карте, затем импортируйте их в таблицу."
        )


def render_main_view(app_state: AppState) -> None:
    """Отрисовывает карту, таблицу точек и управляющие кнопки."""

    st.title("map_orders — подготовка входных данных CP-SAT")
    map_col, table_col = st.columns([2, 3])

    with map_col:
        st.markdown("#### Карта (Орёл, OSM)")
        feature_group = _make_feature_group(app_state.points)
        folium_map = folium.Map(
            location=list(app_state.map_center),
            zoom_start=app_state.map_zoom,
            tiles="OpenStreetMap",
            control_scale=True,
        )
        Draw(
            export=False,
            show_geometry_on_click=False,
            draw_options={
                "polyline": False,
                "polygon": False,
                "circle": False,
                "rectangle": False,
                "circlemarker": False,
                "marker": True,
            },
            edit_options={"remove": True},
        ).add_to(folium_map)

        returned_objects = [
            "last_clicked",
            "last_active_drawing",
            "all_drawings",
            "bounds",
            "zoom",
        ]

        map_state = st_folium(
            folium_map,
            key="map_orders_map",
            height=520,
            width=None,
            center=app_state.map_center,
            zoom=app_state.map_zoom,
            returned_objects=returned_objects,
            feature_group_to_add=feature_group,
        )

        _update_map_position(app_state, map_state)
        st.session_state["map_orders_last_map_state"] = map_state

        col_btn1, col_btn2 = st.columns(2)
        with col_btn1:
            if st.button("Импортировать из карты", use_container_width=True):
                imported = _apply_import_from_map(app_state, map_state)
                st.session_state[_POINTS_EDITOR_KEY] = app_state.points_dataframe()
                if imported:
                    st.success(f"Импортировано точек: {imported}")
                else:
                    st.info("На карте нет точек для импорта")
        with col_btn2:
            if st.button("Очистить", type="secondary", use_container_width=True):
                app_state.points = []
                st.session_state[_POINTS_EDITOR_KEY] = app_state.points_dataframe()
                st.experimental_rerun()

    with table_col:
        st.markdown("#### Таблица точек")
        st.caption("Отметьте один depot, остальные — order")

        if _POINTS_EDITOR_KEY not in st.session_state:
            st.session_state[_POINTS_EDITOR_KEY] = app_state.points_dataframe()

        editor_source = st.session_state[_POINTS_EDITOR_KEY]
        if not isinstance(editor_source, pd.DataFrame):
            editor_source = app_state.points_dataframe()
            st.session_state[_POINTS_EDITOR_KEY] = editor_source

        edited_df = st.data_editor(
            editor_source,
            num_rows="dynamic",
            hide_index=True,
            use_container_width=True,
            key="points_editor_widget",
            column_config=_build_column_config(),
        )

        st.session_state[_POINTS_EDITOR_KEY] = edited_df
        records = edited_df.replace({pd.NA: None}).to_dict(orient="records")
        app_state.update_points_from_records(records)

        if edited_df.empty:
            st.info(
                "Таблица пуста. Добавьте точки на карте и нажмите «Импортировать из карты»."
            )

        st.divider()

        status_placeholder = st.container()
        build_clicked = st.button(
            "Собрать вход CP-SAT",
            type="primary",
            use_container_width=True,
            disabled=edited_df.empty,
        )

        if build_clicked:
            errors, warnings, payload = _prepare_solver_payload(app_state)
            if errors:
                status_placeholder.error(_format_messages(errors))
                st.session_state.pop(_SOLVER_PAYLOAD_KEY, None)
                st.session_state.pop(_SOLVER_WARNINGS_KEY, None)
            else:
                st.session_state[_SOLVER_PAYLOAD_KEY] = payload
                st.session_state[_SOLVER_WARNINGS_KEY] = warnings
                status_placeholder.success(
                    "Входные данные подготовлены — скачайте solver_input.json ниже"
                )

        solver_payload = st.session_state.get(_SOLVER_PAYLOAD_KEY)
        solver_warnings = st.session_state.get(_SOLVER_WARNINGS_KEY, [])

        if solver_payload:
            if solver_warnings:
                st.warning(_format_messages(solver_warnings))

            payload_json = json.dumps(solver_payload, ensure_ascii=False, indent=2)
            st.download_button(
                "Скачать solver_input.json",
                data=payload_json.encode("utf-8"),
                file_name="solver_input.json",
                mime="application/json",
                use_container_width=True,
            )
            with st.expander("Посмотреть solver_input.json"):
                st.code(payload_json, language="json")


def _update_map_position(app_state: AppState, map_state: Dict[str, Any] | None) -> None:
    """Обновляет центр и масштаб карты в AppState."""

    if not map_state:
        return
    zoom = map_state.get("zoom")
    if isinstance(zoom, int):
        app_state.map_zoom = zoom
    bounds = map_state.get("bounds") or {}
    sw = bounds.get("_southWest") or {}
    ne = bounds.get("_northEast") or {}
    lat_values = [sw.get("lat"), ne.get("lat")]
    lon_values = [sw.get("lng"), ne.get("lng")]
    if all(_is_number(value) for value in lat_values + lon_values):
        lat = sum(lat_values) / 2
        lon = sum(lon_values) / 2
        app_state.map_center = (lat, lon)


def _apply_import_from_map(app_state: AppState, map_state: Dict[str, Any] | None) -> int:
    """Импортирует точки из результата st_folium."""

    drawings: Iterable[Dict[str, Any]] = []
    if map_state and map_state.get("all_drawings"):
        drawings = map_state["all_drawings"]

    existing: Dict[str, MapPoint] = {point.id: point for point in app_state.points}
    imported_points: List[MapPoint] = []

    for feature in drawings:
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        coordinates = geometry.get("coordinates") or []
        if len(coordinates) < 2:
            continue
        lon, lat = coordinates[:2]
        props = feature.get("properties") or {}
        point_id = props.get("id")
        point_id = str(point_id) if point_id else None
        base_point = existing.get(point_id) if point_id else None

        extra_payload = props.get("extra_json")
        if isinstance(extra_payload, (dict, list)):
            extra_json = json.dumps(extra_payload, ensure_ascii=False)
        else:
            extra_json = extra_payload or (base_point.extra_json if base_point else "{}")

        candidate = {
            "id": point_id,
            "type": props.get("type") or (base_point.type if base_point else "order"),
            "lat": lat,
            "lon": lon,
            "boxes": props.get("boxes")
            if props.get("boxes") is not None
            else (base_point.boxes if base_point else 1),
            "created_at": props.get("created_at")
            or (base_point.created_at if base_point else None),
            "ready_at": props.get("ready_at")
            or (base_point.ready_at if base_point else None),
            "extra_json": extra_json,
        }

        try:
            point = MapPoint.from_row(candidate)
        except ValueError:
            continue

        if base_point and base_point.meta:
            point.meta = base_point.meta
        imported_points.append(point)

    app_state.points = imported_points
    return len(imported_points)


def _prepare_solver_payload(
    app_state: AppState,
) -> Tuple[List[str], List[str], Optional[Dict[str, Any]]]:
    """Формирует данные для solver_input.json и возвращает (errors, warnings, payload)."""

    raw_points: List[Dict[str, Any]] = []
    for point in app_state.points:
        row = point.to_row()
        row["meta"] = point.meta
        raw_points.append(row)

    points_result = parse_and_validate_points(raw_points)
    errors = list(points_result.errors)
    warnings = list(points_result.warnings)

    if errors:
        return errors, warnings, None

    try:
        coordinates = points_result.coordinates_for_osrm()
        tau = fetch_duration_matrix(app_state.osrm_base_url, coordinates)
    except (ValueError, OsrmError) as exc:
        errors.append(str(exc))
        return errors, warnings, None
    except Exception as exc:  # pragma: no cover - на случай непредвиденных ошибок
        errors.append(f"Не удалось получить матрицу τ: {exc}")
        return errors, warnings, None

    try:
        payload, payload_warnings = make_solver_payload(
            points_result,
            app_state.couriers_json,
            app_state.weights_json,
            app_state.t0_iso or "",
            app_state.osrm_base_url,
            tau,
        )
    except ValidationError as exc:
        errors.extend(exc.errors)
        return errors, warnings, None
    except Exception as exc:  # pragma: no cover - защитная ветка
        errors.append(f"Не удалось собрать вход солвера: {exc}")
        return errors, warnings, None

    warnings.extend(payload_warnings)
    warnings = _deduplicate(warnings)

    return errors, warnings, payload


def _make_feature_group(points: List[MapPoint]) -> folium.FeatureGroup:
    """Создаёт слой для отображения точек на карте."""

    feature_group = folium.FeatureGroup(name="points", show=True)
    features = []
    for point in points:
        extra_value = _safe_json(point.extra_json)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [point.lon, point.lat]},
                "properties": {
                    "id": point.id,
                    "type": point.type,
                    "boxes": point.boxes,
                    "created_at": point.created_at,
                    "ready_at": point.ready_at,
                    "extra_json": extra_value,
                },
            }
        )

    if features:
        geojson = {"type": "FeatureCollection", "features": features}
        tooltip = folium.GeoJsonTooltip(
            fields=["id", "type", "boxes"],
            aliases=["ID", "Тип", "Коробки"],
            labels=True,
        )
        folium.GeoJson(geojson, name="points_layer", tooltip=tooltip).add_to(feature_group)

    return feature_group


def _build_column_config() -> Dict[str, Any]:
    """Возвращает конфигурацию колонок для st.data_editor."""

    return {
        "id": st.column_config.TextColumn("ID", disabled=True, width="small"),
        "type": st.column_config.SelectboxColumn(
            "Тип",
            options=["depot", "order"],
            required=True,
        ),
        "lat": st.column_config.NumberColumn(
            "Широта",
            help="Широта в градусах",
            format="%.6f",
            step=0.000001,
        ),
        "lon": st.column_config.NumberColumn(
            "Долгота",
            help="Долгота в градусах",
            format="%.6f",
            step=0.000001,
        ),
        "boxes": st.column_config.NumberColumn(
            "Коробки",
            min_value=0,
            step=1,
        ),
        "created_at": st.column_config.TextColumn("Создан (ISO)"),
        "ready_at": st.column_config.TextColumn("Готов (ISO)"),
        "extra_json": st.column_config.TextColumn("extra_json"),
    }


def _safe_json(extra_str: str) -> Any:
    """Пытается распарсить строку JSON, возвращает исходную строку при ошибке."""

    if not isinstance(extra_str, str):
        return extra_str
    try:
        return json.loads(extra_str)
    except (TypeError, ValueError):
        return extra_str


def _is_number(value: Any) -> bool:
    """Проверяет, что значение является числом."""

    return isinstance(value, (int, float)) and not pd.isna(value)


def _format_messages(messages: Iterable[str]) -> str:
    """Форматирует список сообщений в bullet-представление."""

    return "\n".join(f"• {msg}" for msg in messages)


def _deduplicate(messages: Iterable[str]) -> List[str]:
    """Удаляет дубликаты, сохраняя порядок."""

    seen: set[str] = set()
    result: List[str] = []
    for msg in messages:
        if msg not in seen:
            seen.add(msg)
            result.append(msg)
    return result

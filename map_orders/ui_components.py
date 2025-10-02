"""Компоненты Streamlit-интерфейса для приложения map_orders."""

from __future__ import annotations

import json
import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

import folium
from folium.plugins import Draw
import pandas as pd
import streamlit as st
from streamlit_folium import st_folium
import requests

from map_orders.io_handlers import (
    export_geojson,
    import_case_bundle,
    import_solver_input,
)
from map_orders.osrm_client import OsrmError, fetch_duration_matrix
from map_orders.transform import (
    ValidationError,
    make_solver_payload,
    parse_and_validate_points,
)

from .state import (
    AppState,
    MapPoint,
    iso_to_hms,
    merge_time_with_base,
    persist_state,
)

_POINTS_EDITOR_KEY = "map_orders_points_editor"
_SOLVER_PAYLOAD_KEY = "map_orders_solver_payload"
_SOLVER_WARNINGS_KEY = "map_orders_solver_warnings"
_MAP_LAYOUT_STYLE_KEY = "map_orders_map_layout_style"
_SHOW_NUMBERS_KEY = "map_orders_show_numbers"

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
        t0_display = iso_to_hms(app_state.t0_iso or "")
        t0_value = st.text_input(
            "T0 (чч:мм:сс)",
            value=t0_display,
            placeholder="15:30:57",
            help="Укажите время в пределах суток в формате HH:MM:SS",
        )
        if t0_value.strip():
            app_state.t0_iso = merge_time_with_base(
                t0_value.strip(),
                app_state.t0_iso,
                app_state.t0_iso,
            )
        st.caption("Времена конвертируются в минуты относительно T0")

        col_couriers_label, col_couriers_btn = st.columns([3, 1])
        with col_couriers_label:
            st.subheader("Курьеры (couriers.json)")
        with col_couriers_btn:
            if st.button("Format", key="btn_beautify_couriers"):
                app_state.couriers_json = _beautify_json_text(app_state.couriers_json)
        app_state.couriers_json = _beautify_json_text(app_state.couriers_json)
        app_state.couriers_json = st.text_area(
            "couriers.json",
            value=app_state.couriers_json,
            height=140,
            help="Словарь с полями a (минуты готовности) и C (вместимости) или массив объектов",
        )

        col_weights_label, col_weights_btn = st.columns([3, 1])
        with col_weights_label:
            st.subheader("Весовые коэффициенты")
        with col_weights_btn:
            if st.button("Format", key="btn_beautify_weights"):
                app_state.weights_json = _beautify_json_text(app_state.weights_json)
        app_state.weights_json = _beautify_json_text(app_state.weights_json)
        app_state.weights_json = st.text_area(
            "weights.json",
            value=app_state.weights_json,
            height=120,
            help="W_cert — штраф за сертификат, W_c2e — click-to-eat, W_skip — пропуск",
        )

        col_extra_label, col_extra_btn = st.columns([3, 1])
        with col_extra_label:
            st.subheader("Дополнительные параметры")
        with col_extra_btn:
            if st.button("Format", key="btn_beautify_additional"):
                app_state.additional_params_json = _beautify_json_text(
                    app_state.additional_params_json
                )
        app_state.additional_params_json = _beautify_json_text(app_state.additional_params_json)
        app_state.additional_params_json = st.text_area(
            "additional_params.json",
            value=app_state.additional_params_json,
            height=100,
            help="JSON-объект, объединяемый с весами, курьерами и заказами",
        )

        st.markdown(
            "*Подсказка:* сначала расставьте точки на карте, затем импортируйте их в таблицу."
        )

        persist_state(app_state)


def render_main_view(app_state: AppState) -> None:
    """Отрисовывает карту, таблицу точек и управляющие кнопки."""

    st.title("map_orders — подготовка входных данных CP-SAT")
    _inject_map_layout_styles()
    map_col, table_col = st.columns([2, 3], vertical_alignment="top")

    if _SHOW_NUMBERS_KEY not in st.session_state:
        st.session_state[_SHOW_NUMBERS_KEY] = False

    with map_col:
        st.markdown("#### Карта (Орёл, OSM)")
        current_state = st.session_state[_SHOW_NUMBERS_KEY]
        toggle_label = "Скрыть номера точек" if current_state else "Отобразить номера точек"
        if st.button(toggle_label, key="map_orders_toggle_numbers"):
            st.session_state[_SHOW_NUMBERS_KEY] = not current_state
            current_state = st.session_state[_SHOW_NUMBERS_KEY]
        show_numbers = current_state

        st.markdown('<div class="map-orders-panel">', unsafe_allow_html=True)
        st.markdown('<div class="map-orders-map">', unsafe_allow_html=True)
        feature_group = _make_feature_group(app_state.points, show_numbers)
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

        returned_objects = ["all_drawings"]

        feature_group.add_to(folium_map)

        with st.spinner("Загружаем карту..."):
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
        st.markdown("</div>", unsafe_allow_html=True)

        st.markdown('<div class="map-orders-actions">', unsafe_allow_html=True)
        col_btn1, col_btn2 = st.columns(2)
        with col_btn1:
            if st.button("Импортировать из карты", width="stretch"):
                imported = _apply_import_from_map(app_state, map_state)
                st.session_state[_POINTS_EDITOR_KEY] = app_state.points_dataframe()
                if imported:
                    st.success(f"Импортировано точек: {imported}")
                else:
                    st.info("На карте нет точек для импорта")
                persist_state(app_state)
        with col_btn2:
            if st.button("Очистить", type="secondary", width="stretch"):
                app_state.points = []
                st.session_state[_POINTS_EDITOR_KEY] = app_state.points_dataframe()
                persist_state(app_state)
                st.rerun()

        st.divider()
        col_export_geojson, col_import_case = st.columns(2)
        with col_export_geojson:
            geojson_payload = export_geojson(app_state)
            st.download_button(
                "Экспорт GeoJSON",
                data=json.dumps(geojson_payload, ensure_ascii=False, indent=2).encode("utf-8"),
                file_name="orders.geojson",
                mime="application/geo+json",
                width="stretch",
            )
        with col_import_case:
            uploaded_bundle = st.file_uploader(
                "Импорт кейса",
                type=["json"],
                accept_multiple_files=False,
                label_visibility="collapsed",
            )
            if uploaded_bundle is not None:
                try:
                    payload = json.load(uploaded_bundle)
                    if isinstance(payload, dict) and "geojson" in payload:
                        import_case_bundle(app_state, payload)
                        success_message = "Кейс успешно импортирован"
                    else:
                        import_solver_input(app_state, payload)
                        success_message = "solver_input.json успешно импортирован"
                    st.session_state[_POINTS_EDITOR_KEY] = app_state.points_dataframe()
                    st.success(success_message)
                    persist_state(app_state)
                    st.rerun()
                except Exception as exc:
                    st.error(f"Не удалось импортировать кейс: {exc}")
        st.markdown("</div>", unsafe_allow_html=True)
        st.markdown("</div>", unsafe_allow_html=True)

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
            width="stretch",
            key="points_editor_widget",
            column_config=_build_column_config(),
        )

        st.session_state[_POINTS_EDITOR_KEY] = edited_df
        records = edited_df.replace({pd.NA: None}).to_dict(orient="records")
        app_state.update_points_from_records(records)
        persist_state(app_state)

        if edited_df.empty:
            st.info(
                "Таблица пуста. Добавьте точки на карте и нажмите «Импортировать из карты»."
            )

        st.divider()

        status_placeholder = st.container()
        build_clicked = st.button(
            "Собрать вход CP-SAT",
            type="primary",
            width="stretch",
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
            width="stretch",
        )
        with st.expander("Посмотреть solver_input.json"):
            st.code(payload_json, language="json")

        col_solver_btn, col_solver_status = st.columns([1, 3])
        with col_solver_btn:
            send_to_solver = st.button("Отправить в Solver", type="primary")
        with col_solver_status:
            solver_response_placeholder = st.empty()

        if send_to_solver:
            try:
                response = _post_solver_request(payload_json)
                solver_response_placeholder.code(response, language="json")
            except Exception as exc:
                solver_response_placeholder.error(f"Ошибка отправки: {exc}")

    persist_state(app_state)


def _inject_map_layout_styles() -> None:
    """Инжектирует CSS для корректного позиционирования карты и кнопок."""

    if st.session_state.get(_MAP_LAYOUT_STYLE_KEY):
        return

    st.session_state[_MAP_LAYOUT_STYLE_KEY] = True
    st.markdown(
        f"""
        <style>
        div[data-testid="column"]:has(.map-orders-panel) {{
            display: flex;
        }}
        div[data-testid="column"]:has(.map-orders-panel) > div {{
            flex: 1 1 auto;
            display: flex;
        }}
        .map-orders-panel {{
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
            width: 100%;
        }}
        .map-orders-map {{
            flex: 0 0 auto;
        }}
        .map-orders-actions {{
            margin-top: auto;
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }}
        .map-orders-actions .stButton > button,
        .map-orders-actions .stDownloadButton > button {{
            width: 100%;
        }}
        .map-orders-actions .stFileUploader,
        .map-orders-actions [data-testid="stFileUploaderDropzone"] {{
            width: 100%;
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )


def _apply_import_from_map(app_state: AppState, map_state: Dict[str, Any] | None) -> int:
    """Импортирует точки из результата st_folium."""

    drawings: Iterable[Dict[str, Any]] = []
    if map_state and map_state.get("all_drawings"):
        drawings = map_state["all_drawings"]

    existing_by_id: Dict[str, MapPoint] = {point.id: point for point in app_state.points if point.id}
    existing_by_coord: Dict[Tuple[float, float], MapPoint] = {
        (_coord_key(point.lat), _coord_key(point.lon)): point for point in app_state.points
    }
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
        base_point = existing_by_id.get(point_id) if point_id else None
        coord_key = (_coord_key(lat), _coord_key(lon))
        if base_point is None:
            base_point = existing_by_coord.get(coord_key)

        extra_payload = props.get("extra_json")
        if isinstance(extra_payload, (dict, list)):
            extra_json = json.dumps(extra_payload, ensure_ascii=False)
        else:
            extra_json = extra_payload or (base_point.extra_json if base_point else "{}")

        if base_point:
            base_point.lat = lat
            base_point.lon = lon
            imported_points.append(base_point)
            existing_by_coord.pop(coord_key, None)
            continue

        candidate = {
            "id": point_id,
            "type": props.get("type") or "order",
            "lat": lat,
            "lon": lon,
            "boxes": props.get("boxes") if props.get("boxes") is not None else 1,
            "created_at": props.get("created_at"),
            "ready_at": props.get("ready_at"),
            "extra_json": extra_json,
        }

        try:
            point = MapPoint.from_row(
                candidate,
                default_base_iso=app_state.t0_iso,
            )
        except ValueError:
            continue

        imported_points.append(point)

    app_state.points = imported_points
    if app_state.points:
        app_state.points[0].type = "depot"
    return len(imported_points)


def _prepare_solver_payload(
    app_state: AppState,
) -> Tuple[List[str], List[str], Optional[Dict[str, Any]]]:
    """Формирует данные для solver_input.json и возвращает (errors, warnings, payload)."""

    raw_points: List[Dict[str, Any]] = []
    sequence_info: List[Dict[str, Any]] = []
    for idx, point in enumerate(app_state.points):
        raw_points.append(
            {
                "id": point.id,
                "type": point.type,
                "lat": point.lat,
                "lon": point.lon,
                "boxes": point.boxes,
                "created_at": point.created_at,
                "ready_at": point.ready_at,
                "extra_json": point.extra_json,
                "meta": {**(point.meta or {}), "seq": idx},
            }
        )
        sequence_info.append(
            {
                "seq": idx,
                "id": point.id,
                "type": point.type,
                "lat": point.lat,
                "lon": point.lon,
                "boxes": point.boxes,
                "created_at": point.created_at,
                "ready_at": point.ready_at,
                "extra_json": point.extra_json,
                "meta": point.meta,
            }
        )

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
            app_state.additional_params_json,
            app_state.t0_iso or "",
            app_state.osrm_base_url,
            tau,
        )
        _attach_sequence_metadata(payload, sequence_info)
    except ValidationError as exc:
        errors.extend(exc.errors)
        return errors, warnings, None
    except Exception as exc:  # pragma: no cover - защитная ветка
        errors.append(f"Не удалось собрать вход солвера: {exc}")
        return errors, warnings, None

    warnings.extend(payload_warnings)
    warnings = _deduplicate(warnings)

    return errors, warnings, payload


def _make_feature_group(points: List[MapPoint], show_numbers: bool) -> folium.FeatureGroup:
    """Создаёт слой для отображения точек на карте."""

    feature_group = folium.FeatureGroup(name="points", show=True)
    if not points:
        return feature_group

    if show_numbers:
        for idx, point in enumerate(points):
            color = "#d63d3d" if idx == 0 else "#1f6ed4"
            text_color = "#ffffff"
            icon_html = (
                "<div style='display:flex;align-items:center;justify-content:center;"
                "font-weight:700;font-size:12px;width:28px;height:28px;"
                "border-radius:50%;border:2px solid #ffffff;"
                "background-color:{bg};color:{fg};'>{idx}</div>"
            ).format(bg=color, fg=text_color, idx=idx)

            tooltip_html = (
                f"№{idx} — {point.type}<br>"
                f"ID: {point.id or '—'}<br>"
                f"Boxes: {point.boxes}"
            )

            folium.Marker(
                [point.lat, point.lon],
                icon=folium.DivIcon(html=icon_html, icon_size=(28, 28), icon_anchor=(14, 14)),
                tooltip=folium.Tooltip(tooltip_html, sticky=True),
            ).add_to(feature_group)
        return feature_group

    features = []
    for idx, point in enumerate(points):
        extra_value = _safe_json(point.extra_json)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [point.lon, point.lat]},
                "properties": {
                    "seq": idx,
                    "id": point.id,
                    "type": point.type,
                    "boxes": point.boxes,
                    "created_at": point.created_at,
                    "ready_at": point.ready_at,
                    "extra_json": extra_value,
                },
            }
        )

    geojson = {"type": "FeatureCollection", "features": features}
    tooltip = folium.GeoJsonTooltip(
        fields=["seq", "id", "type", "boxes"],
        aliases=["№", "ID", "Тип", "Коробки"],
        labels=True,
    )
    folium.GeoJson(geojson, name="points_layer", tooltip=tooltip).add_to(feature_group)

    return feature_group


def _build_column_config() -> Dict[str, Any]:
    """Возвращает конфигурацию колонок для st.data_editor."""

    return {
        "seq": st.column_config.TextColumn("№", disabled=True, width="small"),
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
        "created_at": st.column_config.TextColumn(
            "Создан в",
            help="Формат HH:MM:SS",
        ),
        "ready_at": st.column_config.TextColumn(
            "Будет готов",
            help="Формат HH:MM:SS",
        ),
        "extra_json": st.column_config.TextColumn("extra_json"),
    }


def _coord_key(value: float) -> float:
    """Округляет координату для сравнения точек."""

    try:
        return round(float(value), 6)
    except (TypeError, ValueError):  # pragma: no cover - защитная ветка
        return float("nan")


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


_JSON_INDENT = 2


def _beautify_json_text(source: str) -> str:
    """Возвращает красиво форматированный JSON или исходный текст."""

    if not source or not source.strip():
        return ""
    try:
        parsed = json.loads(source)
    except (TypeError, ValueError):
        return source
    return _format_json_value(parsed)


def _format_json_value(value: Any, indent: int = 0) -> str:
    """Форматирует значение JSON с учётом плоских массивов."""

    space = " " * indent
    if isinstance(value, dict):
        if not value:
            return "{}"
        items = list(value.items())
        inner_lines = []
        for idx, (key, val) in enumerate(items):
            formatted = _format_json_value(val, indent + _JSON_INDENT)
            comma = "," if idx < len(items) - 1 else ""
            inner_lines.append(
                f"{' ' * (indent + _JSON_INDENT)}{json.dumps(key, ensure_ascii=False)}: {formatted}{comma}"
            )
        inner = "\n".join(inner_lines)
        return "{\n" + inner + "\n" + space + "}"

    if isinstance(value, list):
        if not value:
            return "[]"
        if all(_is_json_scalar(item) for item in value):
            items = ", ".join(json.dumps(item, ensure_ascii=False) for item in value)
            return "[" + items + "]"
        inner_lines = []
        for idx, item in enumerate(value):
            formatted = _format_json_value(item, indent + _JSON_INDENT)
            comma = "," if idx < len(value) - 1 else ""
            inner_lines.append(
                f"{' ' * (indent + _JSON_INDENT)}{formatted}{comma}"
            )
        inner = "\n".join(inner_lines)
        return "[\n" + inner + "\n" + space + "]"

    if isinstance(value, float) and value.is_integer():
        value = int(value)

    return json.dumps(value, ensure_ascii=False)


def _is_json_scalar(value: Any) -> bool:
    """Возвращает True для скалярных значений JSON."""

    return isinstance(value, (str, int, float, bool)) or value is None


def _post_solver_request(payload_json: str) -> str:
    """Отправляет solver_input.json в локальный солвер и возвращает ответ."""

    try:
        response = requests.post(
            "http://127.0.0.1:8000/solve-gpt",
            headers={"Content-Type": "application/json"},
            data=payload_json.encode("utf-8"),
            timeout=30,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise RuntimeError(f"{exc}") from exc

    try:
        parsed = response.json()
    except ValueError:
        return response.text

    return json.dumps(parsed, ensure_ascii=False, indent=2)


def _attach_sequence_metadata(payload: Dict[str, Any], sequence_info: List[Dict[str, Any]]) -> None:
    """Добавляет сведения о номерах точек в payload."""

    meta = payload.setdefault("meta", {})
    meta["points_sequence"] = sequence_info

    combined = meta.get("combined_params")
    if isinstance(combined, dict):
        combined["points_sequence"] = sequence_info

        orders = combined.get("orders")
        if isinstance(orders, list):
            for order in orders:
                entry = _match_sequence_entry(order, sequence_info)
                if entry is not None:
                    order["seq"] = entry.get("seq")
                    order.setdefault("extra_json", entry.get("extra_json"))
                    if entry.get("meta"):
                        order.setdefault("meta", entry.get("meta"))

        depot = combined.get("depot")
        if isinstance(depot, dict):
            entry = _match_sequence_entry(depot, sequence_info)
            if entry is not None:
                depot["seq"] = entry.get("seq")
                depot.setdefault("extra_json", entry.get("extra_json"))
                if entry.get("meta"):
                    depot.setdefault("meta", entry.get("meta"))


def _find_sequence_for_candidate(
    candidate: Dict[str, Any], sequence_info: List[Dict[str, Any]]
) -> Optional[int]:
    """Находит номер точки по ID или координатам."""

    entry = _match_sequence_entry(candidate, sequence_info)
    return entry.get("seq") if entry is not None else None


def _match_sequence_entry(
    candidate: Dict[str, Any], sequence_info: List[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """Возвращает запись последовательности для заданного кандидата."""

    candidate_id = candidate.get("id")
    if candidate_id:
        for entry in sequence_info:
            if entry.get("id") and entry["id"] == candidate_id:
                return entry

    try:
        lat = float(candidate.get("lat"))
        lon = float(candidate.get("lon"))
    except (TypeError, ValueError):
        return None

    for entry in sequence_info:
        if math.isclose(entry["lat"], lat, abs_tol=1e-6) and math.isclose(
            entry["lon"], lon, abs_tol=1e-6
        ):
            return entry

    return None

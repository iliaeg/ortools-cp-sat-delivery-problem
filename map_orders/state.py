"""Состояние приложения Streamlit и утилиты для работы с точками."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
from typing import Any, Dict, Iterable, List
from uuid import uuid4

import pandas as pd


TIME_PATTERN = re.compile(r"^(\d{2}):(\d{2}):(\d{2})$")


POINT_COLUMNS = [
    "seq",
    "id",
    "type",
    "lat",
    "lon",
    "boxes",
    "created_at",
    "ready_at",
    "extra_json",
]


def _now_iso() -> str:
    """Возвращает текущий момент в ISO 8601 с точностью до секунд."""

    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def iso_to_hms(value: str) -> str:
    """Преобразует ISO-время в формат HH:MM:SS."""

    if not isinstance(value, str) or not value.strip():
        return ""

    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return value

    return dt.strftime("%H:%M:%S")


def merge_time_with_base(
    value: Any,
    fallback_iso: str | None,
    default_base_iso: str | None,
) -> str:
    """Возвращает ISO-строку, комбинируя время HH:MM:SS с базовой датой."""

    if isinstance(value, datetime):
        base_dt = value
        if base_dt.tzinfo is None:
            base_dt = base_dt.astimezone()
        return base_dt.isoformat(timespec="seconds")

    if not isinstance(value, str) or not value.strip():
        if fallback_iso:
            return fallback_iso
        base_dt = datetime.fromisoformat(default_base_iso) if default_base_iso else datetime.now(timezone.utc).astimezone()
        return base_dt.isoformat(timespec="seconds")

    text = value.strip()

    try:
        dt = datetime.fromisoformat(text)
        return dt.isoformat(timespec="seconds")
    except ValueError:
        pass

    match = TIME_PATTERN.match(text)
    if not match:
        if fallback_iso:
            return fallback_iso
        return text

    hours, minutes, seconds = map(int, match.groups())

    base_source = fallback_iso or default_base_iso
    if base_source:
        try:
            base_dt = datetime.fromisoformat(base_source)
        except ValueError:
            base_dt = datetime.now(timezone.utc).astimezone()
    else:
        base_dt = datetime.now(timezone.utc).astimezone()

    if base_dt.tzinfo is None:
        base_dt = base_dt.astimezone()

    combined = base_dt.replace(hour=hours, minute=minutes, second=seconds, microsecond=0)
    return combined.isoformat(timespec="seconds")


def _make_point_id() -> str:
    """Генерирует короткий идентификатор точки."""

    return uuid4().hex[:8]


@dataclass
class MapPoint:
    """Структура данных точки на карте."""

    id: str
    type: str
    lat: float
    lon: float
    boxes: int
    created_at: str
    ready_at: str
    extra_json: str
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_row(self) -> Dict[str, Any]:
        """Возвращает словарь для отображения и редактирования в таблице."""

        return {
            "id": self.id,
            "type": self.type,
            "lat": self.lat,
            "lon": self.lon,
            "boxes": self.boxes,
            "created_at": iso_to_hms(self.created_at),
            "ready_at": iso_to_hms(self.ready_at),
            "extra_json": self.extra_json,
        }

    @classmethod
    def from_row(
        cls,
        row: Dict[str, Any],
        *,
        base_point: "MapPoint" | None = None,
        default_base_iso: str | None = None,
    ) -> "MapPoint":
        """Создаёт MapPoint на основе данных из таблицы."""

        point_id = str(row.get("id")) if row.get("id") else _make_point_id()
        try:
            lat = float(row.get("lat"))
            lon = float(row.get("lon"))
        except (TypeError, ValueError) as exc:
            raise ValueError("lat/lon должны быть числами") from exc
        if math.isnan(lat) or math.isnan(lon):
            raise ValueError("lat/lon не должны быть пустыми")

        boxes_raw = row.get("boxes", 1)
        try:
            if isinstance(boxes_raw, float) and math.isnan(boxes_raw):
                boxes = 0
            else:
                boxes = int(boxes_raw)
        except (TypeError, ValueError):
            boxes = 0

        created_at = merge_time_with_base(
            row.get("created_at"),
            base_point.created_at if base_point else None,
            default_base_iso,
        )
        ready_at = merge_time_with_base(
            row.get("ready_at"),
            base_point.ready_at if base_point else None,
            default_base_iso,
        )

        extra_raw = row.get("extra_json")
        if isinstance(extra_raw, (dict, list)):
            extra_json = json.dumps(extra_raw, ensure_ascii=False)
        else:
            extra_json = str(extra_raw or "{}")

        meta = row.get("meta") or {}
        if not isinstance(meta, dict):
            meta = {}

        return cls(
            id=point_id,
            type=str(row.get("type") or "order"),
            lat=lat,
            lon=lon,
            boxes=boxes,
            created_at=created_at,
            ready_at=ready_at,
            extra_json=extra_json,
            meta=meta,
        )


@dataclass
class AppState:
    """Контейнер основных данных приложения."""

    points: List[MapPoint] = field(default_factory=list)
    couriers_json: str = "{\"a\": [0, 40], \"C\": [25, 25]}"
    weights_json: str = "{\"W_cert\": 1000, \"W_c2e\": 1, \"W_skip\": 200}"
    additional_params_json: str = "{\"time_limit\": 3.0}"
    osrm_base_url: str = "http://localhost:5563"
    t0_iso: str | None = None
    map_center: tuple[float, float] = (52.9676, 36.0693)
    map_zoom: int = 13

    def points_dataframe(self) -> pd.DataFrame:
        """Возвращает pandas.DataFrame для отображения точек в UI."""

        if not self.points:
            return pd.DataFrame(columns=POINT_COLUMNS)
        data = []
        for idx, point in enumerate(self.points):
            row = point.to_row()
            row["seq"] = idx
            data.append(row)
        return pd.DataFrame(data, columns=POINT_COLUMNS)

    def update_points_from_records(self, records: Iterable[Dict[str, Any]]) -> None:
        """Обновляет список точек на основе данных из редактора."""

        updated: List[MapPoint] = []
        existing_by_id = {point.id: point for point in self.points}
        for record in records:
            try:
                base_point = existing_by_id.get(str(record.get("id")) if record.get("id") else "")
                updated.append(
                    MapPoint.from_row(
                        record,
                        base_point=base_point,
                        default_base_iso=self.t0_iso,
                    )
                )
            except ValueError:
                # Игнорируем некорректные строки, пользователь увидит ошибки валидации позже
                continue
        self.points = updated
        if self.points:
            self.points[0].type = "depot"


def ensure_session_state(st_session_state: Any) -> AppState:
    """Гарантирует наличие AppState в session_state Streamlit."""

    if "map_orders_state" not in st_session_state:
        persisted = load_persisted_state()
        if persisted is not None:
            st_session_state.map_orders_state = persisted
        else:
            st_session_state.map_orders_state = AppState(t0_iso=_now_iso())
            persist_state(st_session_state.map_orders_state)
    state: AppState = st_session_state.map_orders_state
    if not state.t0_iso:
        state.t0_iso = _now_iso()
    return state


def persist_state(app_state: AppState) -> None:
    """Сохраняет текущее состояние приложения на диск."""

    try:
        data = {
            "points": [
                {
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
                for point in app_state.points
            ],
            "couriers_json": app_state.couriers_json,
            "weights_json": app_state.weights_json,
            "additional_params_json": app_state.additional_params_json,
            "osrm_base_url": app_state.osrm_base_url,
            "t0_iso": app_state.t0_iso,
            "map_center": list(app_state.map_center),
            "map_zoom": app_state.map_zoom,
        }
        _STATE_STORAGE_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def load_persisted_state() -> AppState | None:
    """Загружает состояние приложения с диска, если оно существует."""

    if not _STATE_STORAGE_PATH.exists():
        return None

    try:
        raw_data = json.loads(_STATE_STORAGE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    state = AppState()
    state.couriers_json = raw_data.get("couriers_json", state.couriers_json)
    state.weights_json = raw_data.get("weights_json", state.weights_json)
    state.additional_params_json = raw_data.get(
        "additional_params_json", state.additional_params_json
    )
    state.osrm_base_url = raw_data.get("osrm_base_url", state.osrm_base_url)
    state.t0_iso = raw_data.get("t0_iso") or state.t0_iso

    map_center = raw_data.get("map_center")
    if isinstance(map_center, (list, tuple)) and len(map_center) >= 2:
        try:
            state.map_center = (float(map_center[0]), float(map_center[1]))
        except (TypeError, ValueError):
            pass

    map_zoom = raw_data.get("map_zoom")
    if isinstance(map_zoom, int) and 1 <= map_zoom <= 20:
        state.map_zoom = map_zoom

    points_payload = raw_data.get("points", [])
    restored_points: List[MapPoint] = []
    for payload in points_payload:
        if not isinstance(payload, dict):
            continue
        payload = payload.copy()
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        payload["meta"] = meta
        try:
            point = MapPoint.from_row(payload, default_base_iso=state.t0_iso)
            point.meta = meta
            restored_points.append(point)
        except ValueError:
            continue

    state.points = restored_points
    if state.points:
        state.points[0].type = "depot"

    return state
_STATE_STORAGE_PATH = Path(__file__).resolve().parent / ".map_orders_state.json"

"""Состояние приложения Streamlit и утилиты для работы с точками."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import math
from typing import Any, Dict, Iterable, List
from uuid import uuid4

import pandas as pd


POINT_COLUMNS = [
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
            "created_at": self.created_at,
            "ready_at": self.ready_at,
            "extra_json": self.extra_json,
        }

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "MapPoint":
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

        created_at = str(row.get("created_at") or _now_iso())
        ready_at = str(row.get("ready_at") or _now_iso())

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
    couriers_json: str = "[]"
    weights_json: str = "{\"W_cert\": 1000, \"W_c2e\": 1, \"W_skip\": 200}"
    osrm_base_url: str = "http://localhost:5563"
    t0_iso: str | None = None
    map_center: tuple[float, float] = (52.9676, 36.0693)
    map_zoom: int = 13

    def points_dataframe(self) -> pd.DataFrame:
        """Возвращает pandas.DataFrame для отображения точек в UI."""

        if not self.points:
            return pd.DataFrame(columns=POINT_COLUMNS)
        data = [point.to_row() for point in self.points]
        return pd.DataFrame(data, columns=POINT_COLUMNS)

    def update_points_from_records(self, records: Iterable[Dict[str, Any]]) -> None:
        """Обновляет список точек на основе данных из редактора."""

        updated: List[MapPoint] = []
        for record in records:
            try:
                updated.append(MapPoint.from_row(record))
            except ValueError:
                # Игнорируем некорректные строки, пользователь увидит ошибки валидации позже
                continue
        self.points = updated


def ensure_session_state(st_session_state: Any) -> AppState:
    """Гарантирует наличие AppState в session_state Streamlit."""

    if "map_orders_state" not in st_session_state:
        st_session_state.map_orders_state = AppState(t0_iso=_now_iso())
    state: AppState = st_session_state.map_orders_state
    if not state.t0_iso:
        state.t0_iso = _now_iso()
    return state

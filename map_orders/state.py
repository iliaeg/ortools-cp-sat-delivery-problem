"""Инициализация и вспомогательные функции для session_state Streamlit."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


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


@dataclass
class MapPoint:
    """Структура данных точки на карте с минимальными валидациями."""

    id: str
    type: str
    lat: float
    lon: float
    boxes: int
    created_at: str
    ready_at: str
    extra_json: str
    meta: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AppState:
    """Контейнер основных данных приложения."""

    points: List[MapPoint] = field(default_factory=list)
    couriers_json: str = "[]"
    weights_json: str = "{\"W_cert\": 1000, \"W_c2e\": 1, \"W_skip\": 200}"
    osrm_base_url: str = "http://localhost:5000"
    t0_iso: str | None = None
    map_center: tuple[float, float] = (52.9676, 36.0693)
    map_zoom: int = 13


def ensure_session_state(st_session_state: Any) -> AppState:
    """Гарантирует наличие AppState в session_state Streamlit."""

    if "map_orders_state" not in st_session_state:
        st_session_state.map_orders_state = AppState()
    return st_session_state.map_orders_state

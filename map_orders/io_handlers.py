"""Импорт и экспорт данных приложения."""

from __future__ import annotations

from typing import Any, Dict


def export_geojson(app_state: Any) -> Dict[str, Any]:
    """Возвращает GeoJSON для текущих точек (заглушка)."""

    raise NotImplementedError("Будет реализовано на следующей фазе")


def export_case_bundle(app_state: Any) -> Dict[str, Any]:
    """Возвращает кейс-бандл (заглушка)."""

    raise NotImplementedError("Будет реализовано на следующей фазе")


def import_case_bundle(app_state: Any, payload: Dict[str, Any]) -> None:
    """Импортирует состояние из бандла (заглушка)."""

    raise NotImplementedError("Будет реализовано на следующей фазе")

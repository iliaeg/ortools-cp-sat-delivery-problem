"""Клиент для обращения к OSRM Table API."""

from __future__ import annotations

from typing import List, Sequence


class OsrmError(RuntimeError):
    """Ошибка при обращении к OSRM."""


def build_table_url(base_url: str, coordinates: Sequence[tuple[float, float]]) -> str:
    """Формирует URL для Table API по списку координат."""

    if not coordinates:
        raise ValueError("coordinates must not be empty")
    pairs = [f"{lon:.6f},{lat:.6f}" for lat, lon in coordinates]
    joined = ";".join(pairs)
    return f"{base_url.rstrip('/')}/table/v1/driving/{joined}?annotations=duration"


def fetch_duration_matrix(base_url: str, coordinates: Sequence[tuple[float, float]]) -> List[List[int]]:
    """Возвращает матрицу времени в пути в минутах (заглушка)."""

    raise NotImplementedError("Будет реализовано на следующей фазе")

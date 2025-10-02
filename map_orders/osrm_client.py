"""Клиент для обращения к OSRM Table API."""

from __future__ import annotations

import json
from typing import List, Sequence

import requests


class OsrmError(RuntimeError):
    """Ошибка при обращении к OSRM."""


def build_table_url(base_url: str, coordinates: Sequence[tuple[float, float]]) -> str:
    """Формирует URL для Table API по списку координат."""

    if not coordinates:
        raise ValueError("coordinates must not be empty")
    base = (base_url or "").strip()
    if not base:
        raise ValueError("OSRM base URL не задан")
    pairs = [f"{lon:.6f},{lat:.6f}" for lat, lon in coordinates]
    joined = ";".join(pairs)
    return f"{base.rstrip('/')}/table/v1/driving/{joined}?annotations=duration"


def fetch_duration_matrix(
    base_url: str,
    coordinates: Sequence[tuple[float, float]],
    *,
    timeout: float = 20.0,
) -> List[List[int]]:
    """Возвращает матрицу времени в пути в минутах с округлением до целых."""

    url = build_table_url(base_url, coordinates)
    try:
        response = requests.get(url, timeout=timeout)
    except requests.RequestException as exc:  # pragma: no cover - сеть
        raise OsrmError(f"Не удалось обратиться к OSRM: {exc}") from exc

    if response.status_code != 200:
        message = _extract_error_message(response)
        raise OsrmError(
            f"OSRM вернул статус {response.status_code}: {message}"
        )

    try:
        payload = response.json()
    except json.JSONDecodeError as exc:  # pragma: no cover - защитная ветка
        raise OsrmError("OSRM вернул некорректный JSON") from exc

    durations = payload.get("durations")
    expected_size = len(coordinates)
    if not isinstance(durations, list) or len(durations) != expected_size:
        raise OsrmError("OSRM ответ не содержит матрицу нужного размера")

    matrix: List[List[int]] = []
    for i, row in enumerate(durations):
        if not isinstance(row, list) or len(row) != expected_size:
            raise OsrmError("OSRM вернул некорректную строку матрицы")
        row_minutes: List[int] = []
        for j, value in enumerate(row):
            if value is None:
                raise OsrmError(
                    f"OSRM не может построить маршрут между точками {i} и {j}"
                )
            try:
                seconds = float(value)
            except (TypeError, ValueError) as exc:
                raise OsrmError("OSRM вернул некорректное значение в матрице") from exc

            minutes = max(0, int(round(seconds / 60.0)))
            if i == j:
                minutes = 0
            row_minutes.append(minutes)
        matrix.append(row_minutes)

    return matrix


def _extract_error_message(response: requests.Response) -> str:
    """Пытается извлечь осмысленное сообщение об ошибке из ответа OSRM."""

    try:
        data = response.json()
    except json.JSONDecodeError:
        text = response.text.strip()
        return text if text else "не удалось получить сообщение"

    if isinstance(data, dict):
        message = data.get("message") or data.get("error")
        if message:
            return str(message)
    return "не удалось получить сообщение"

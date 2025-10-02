"""Преобразования данных и подготовка входа для солвера."""

from __future__ import annotations

from typing import Any, Dict, List


def parse_and_validate_points(raw_points: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Парсит и валидирует точки (заглушка)."""

    raise NotImplementedError("Будет реализовано на следующей фазе")


def make_solver_payload(validated: Dict[str, Any]) -> Dict[str, Any]:
    """Собирает solver_input.json (заглушка)."""

    raise NotImplementedError("Будет реализовано на следующей фазе")

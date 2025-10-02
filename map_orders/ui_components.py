"""Компоненты Streamlit-интерфейса."""

from __future__ import annotations

from typing import Any


def render_sidebar(app_state: Any) -> None:
    """Отрисовывает боковую панель (заглушка)."""

    raise NotImplementedError("Будет реализовано на следующей фазе")


def render_main_view(app_state: Any) -> None:
    """Отрисовывает основную область (заглушка)."""

    raise NotImplementedError("Будет реализовано на следующей фазе")

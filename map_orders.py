"""Streamlit-приложение для подготовки входных данных CP-SAT."""

from __future__ import annotations

import streamlit as st

from map_orders.state import ensure_session_state
from map_orders.ui_components import render_main_view, render_sidebar


def main() -> None:
    """Точка входа Streamlit-приложения."""

    st.set_page_config(page_title="map_orders", layout="wide")
    app_state = ensure_session_state(st.session_state)
    render_sidebar(app_state)
    render_main_view(app_state)


if __name__ == "__main__":
    main()

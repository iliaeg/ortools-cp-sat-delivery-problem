"""Streamlit-приложение для подготовки входных данных CP-SAT."""

from __future__ import annotations

import streamlit as st

from map_orders.state import ensure_session_state


def main() -> None:
    """Точка входа Streamlit-приложения."""

    st.set_page_config(page_title="map_orders", layout="wide")
    app_state = ensure_session_state(st.session_state)
    st.title("map_orders — подготовка входа CP-SAT")
    st.info(
        "Интерфейс находится в разработке. На следующих шагах появится карта, «
        "таблица точек, формы параметров и экспорт данных."
    )
    st.json({"osrm_base_url": app_state.osrm_base_url, "t0_iso": app_state.t0_iso})


if __name__ == "__main__":
    main()

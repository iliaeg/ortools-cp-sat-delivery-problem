# ortools-cp-sat-v2

Проект для экспериментов с CP-SAT из библиотеки OR-Tools и локального интерфейса подготовки входных данных.

## Требования
- Python 3.11
- [Poetry](https://python-poetry.org/)

## Подготовка окружения
1. Установите Poetry, если он ещё не установлен (см. инструкцию по ссылке выше).
2. Убедитесь, что локально доступен Python 3.11. При необходимости выберите его для виртуального окружения:
   ```bash
   poetry env use 3.11
   ```
3. Установите зависимости проекта:
   ```bash
   poetry install
   ```

## Работа с проектом
- Активируйте окружение, если нужен интерактивный сеанс:
  ```bash
  poetry shell
  ```
- Запустите FastAPI-приложение c обёрткой над CP-SAT:
  ```bash
  poetry run uvicorn order_grouping.api:app --reload
  ```
- Запускайте скрипты или модули через Poetry без активации shell:
  ```bash
  poetry run python path/to_script.py
  ```
- Для запуска тестов:
  ```bash
  poetry run pytest
  ```

## map_orders — Streamlit интерфейс подготовки входа
1. Загрузите данные OSM и запустите локальный OSRM (пример для региона Россия):
   ```bash
   docker run -t -i -p 5000:5000 osrm/osrm-backend bash -lc "\
     wget -O /data/russia-latest.osm.pbf https://download.geofabrik.de/russia-latest.osm.pbf && \
     osrm-extract -p /opt/car.lua /data/russia-latest.osm.pbf && \
     osrm-partition /data/russia-latest.osrm && \
     osrm-customize /data/russia-latest.osrm && \
     osrm-routed --algorithm mld /data/russia-latest.osrm"
   ```
2. Запустите интерфейс:
   ```bash
   poetry run streamlit run map_orders.py
   ```
3. На странице приложения:
   - Расставьте точки на карте и импортируйте их в таблицу.
   - Отметьте ровно один `depot` и заполните параметры заказов.
   - Задайте курьеров и веса, установите T0.
   - Сформируйте `solver_input.json` либо экспортируйте GeoJSON/кейс-бандл.

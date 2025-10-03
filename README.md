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

## map_orders — Next.js интерфейс подготовки входных данных

Для работы клиентского приложения используются Node.js ≥ 20 и Yarn Classic. Подробное описание находится в `map_orders_app/README.md`, ниже — краткое резюме.

1. Установите зависимости и подготовьте окружение:
   ```bash
   cd map_orders_app
   yarn install
   # создайте .env.local по инструкции из map_orders_app/README.md
   ```
2. Убедитесь, что доступны внешние сервисы:
   - локальный OSRM (см. пример ниже)
   - HTTP-обёртка над CP-SAT (`order_grouping.api`) — см. раздел выше про FastAPI
3. Запустите dev-сервер:
   ```bash
   yarn dev
   ```
   Приложение будет доступно на `http://localhost:3000`.

Полезные команды (выполняются из каталога `map_orders_app`):
- `yarn lint` — проверки кода ESLint
- `yarn type-check` — строгий `tsc --noEmit`
- `yarn test` — unit/logic тесты (Vitest)
- `yarn test:e2e` — Playwright smoke-сценарии (dev-сервер должен быть запущен отдельно)

<details>
<summary>Запуск локального OSRM</summary>

В репозитории есть готовая конфигурация для Docker Compose:

```bash
docker compose -f docker/osrm/docker-compose.yml up --build
```

Команда поднимет контейнер с демо-картой Orel (порт 5563). После запуска сервис будет доступен по адресу `http://localhost:5563`. Не забудьте остановить контейнер, когда он больше не нужен:

```bash
docker compose -f docker/osrm/docker-compose.yml down
```

</details>

Экспортируемые файлы:
- `orders.geojson` — `FeatureCollection` с точками `depot/order`; свойства включают `boxes`, `created_at`, `ready_at`, а при ошибках разбора добавляется `_extra_parse_error`.
- `case_bundle.json` — полный бандл состояния (`t0_iso`, параметры, GeoJSON, настройки OSRM и т.д.).

# ortools-cp-sat-delivery-problem

Проект для экспериментов с CP-SAT из библиотеки OR-Tools и локального интерфейса подготовки входных данных.

## Python оптимизатор (`order_grouping/`)

Весь Python-код (FastAPI, CP-SAT решатель, тесты, артефакты Poetry) живёт в каталоге `order_grouping/`, чтобы не мешаться рядом с фронтендом. Подробная инструкция находится в `order_grouping/README.md`.

Кратко основные команды (выполняются внутри `order_grouping/`):
- `poetry env use 3.11`
- `poetry install`
- `poetry run uvicorn order_grouping.api:app --reload`
- `poetry run pytest`

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

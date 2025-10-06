# map_orders — подготовка входных данных CP-SAT и визуализация маршрутов

Одностраничное Next.js-приложение для подготовки кейсов CP-SAT решателя, формирования `solver_input.json` через локальный OSRM и визуализации результатов маршрутизации. Интерфейс организован по принципам Feature-Sliced Design и полностью на русском языке.

## Возможности

- Редактирование карты Орла (Leaflet + draw control): добавление/удаление точек, перемещение маркеров, экспорт GeoJSON.
- Таблица заказов на базе MUI DataGrid с валидацией координат, времени, JSON и ограничением на единственное депо.
- Панель параметров: курьеры, весовые коэффициенты, дополнительные опции, T0 и базовый URL OSRM.
- Сбор solver_input с обращением к локальному OSRM (`/table/v1/driving`) и преобразованием времени к T0.
- Отправка solver_input в локальный CP-SAT решатель (`POST http://127.0.0.1:8000/solve-internal`), расчёт ETA/Click-to-Eat, визуализация маршрутов и computed-колонок.
- Импорт/экспорт GeoJSON, solver_input и полноценных кейсов. Состояние хранится в `data/map_orders_state.json`.
- Автосохранение состояния через API `GET/PUT /api/map-orders/state`.

## Требования

- Node.js ≥ 20
- Yarn 1 (Classic)
- Локальный OSRM (`docker/osrm/docker-compose.yml`) с портом 5563
- Локальный REST-обёртка CP-SAT (`http://127.0.0.1:8000/solve-internal`)

## Установка

```bash
yarn install
```

### Переменные окружения

Создайте `.env.local`, пример:

```
NEXT_PUBLIC_OSRM_BASE_URL=http://localhost:5563
NEXT_PUBLIC_SOLVER_URL=http://127.0.0.1:8000/solve-internal
OSRM_BASE_URL=http://localhost:5563
SOLVER_URL=http://127.0.0.1:8000/solve-internal
MAP_ORDERS_STATE_PATH=./data/map_orders_state.json
```

- `NEXT_PUBLIC_*` используются на клиенте.
- Серверные переменные управляют API-роутами Next.js.
- Путь к состоянию можно переопределить (по умолчанию `./data/map_orders_state.json`).

### OSRM

```bash
cd ../docker/osrm
./download_and_prepare.sh   # подготовка карт (один раз)
docker compose up            # сервис слушает 5563 порт
```

### CP-SAT solver

Запустите имеющийся REST сервис (`python map_orders.py` либо требуемый docker). API должен принимать `POST /solve-internal` и возвращать структуру, описанную в техническом задании.

## Скрипты

| Команда              | Назначение                                   |
|----------------------|-----------------------------------------------|
| `yarn dev`           | режим разработки (http://localhost:3000)      |
| `yarn build`         | production-сборка Next.js                     |
| `yarn start`         | запуск собранного приложения                  |
| `yarn lint`          | ESLint (`src/**/*.ts(x)`)                     |
| `yarn type-check`    | строгая проверка TypeScript                   |
| `yarn test`          | unit/интеграционные тесты (Vitest + RTL)      |
| `yarn test:e2e`      | e2e Playwright (перед запуском `npx playwright install`) |

Все команды выполняются из директории `map_orders_app`. Например, полный прогон проверок:

```bash
cd map_orders_app
yarn lint
yarn type-check
yarn test
```

Playwright использует `tests/e2e`. Для smoke-тестов необходимо поднять dev-сервер: `yarn dev` в одном терминале, `yarn test:e2e` в другом.

## Архитектура

Проект организован по Feature-Sliced Design:

```
src/
├─ app/                # Next.js App Router, страницы и layout
├─ processes/          # кросс-слайсовые процессы (инициализация, автосейв)
├─ widgets/            # комплексные UI-блоки (карта, таблица, панели)
├─ features/           # бизнес-фичи и состояние (map-orders slice)
├─ entities/           # доменные сущности
├─ shared/             # базовые утилиты, api, store, типы
```

Состояние хранится в Redux Toolkit + RTK Query (`src/shared/store`). Автосохранение выполняется через `StateAutoSaver`, бэкенд-роуты находятся в `src/app/api/map-orders/*` и используют чистые сервисы из `src/processes/map-orders/lib`.

## Структура API

- `GET /api/map-orders/state` / `PUT /api/map-orders/state` — загрузка и сохранение состояния.
- `POST /api/map-orders/solver-input` — сбор solver_input; обращается к OSRM и выполняет валидацию.
- `POST /api/map-orders/solve` — прокси к локальному решателю, маппинг результата на UI.
- `GET /api/map-orders/export/geojson` — выгрузка точек в GeoJSON.
- `GET /api/map-orders/export/case` — экспорт полного кейса.
- `POST /api/map-orders/import/case` — импорт кейса (FormData, поле `payload`).
- `POST /api/map-orders/import/solver-input` — импорт solver_input.

## Тесты

- Vitest для unit/logic (`src/processes/map-orders/lib/__tests__`).
- React Testing Library готова к подключениям компонентных тестов.
- Playwright smoke-сценарий `tests/e2e/map-orders-smoke.spec.ts`.

Перед тестами убедитесь, что настроены переменные окружения и запущены внешние сервисы.

## Полезно знать

- Все времена вводятся в формате `HH:MM:SS`. `created_at` допускает значения ≤0 относительно T0, `ready_at` и времена доступности курьеров — только ≥0.
- Цвета маршрутов фиксированы (`src/shared/constants/routes.ts`).
- Файлы solver_input сохраняются через FileSaver. Импорт кейса/solver_input автоматически обновляет состояние и глобальное хранилище.

## Локальное состояние

Файл `data/map_orders_state.json` создаётся автоматически. Убедитесь, что у процесса есть права на запись.

---

Для уточнений и дополнительной информации смотрите техническое задание и `ai_notes/development-rules.md` в корне репозитория.

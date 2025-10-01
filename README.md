# ortools-cp-sat-v2

Проект для экспериментов с CP-SAT из библиотеки OR-Tools.

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

from typing import Any, Dict, List, Tuple
from ortools.sat.python import cp_model


class Solver:
    """
    Монолитный CP-SAT решатель для задачи доставки пиццы.

    Текущее время принимается за 0 (точку отсчёта), created_at от него отсчитывается в прошлое.

    -----------------------
    ОЖИДАЕМЫЙ ВХОД (problem: dict)
    -----------------------
    Обязательные поля:
      - "tau": List[List[int]] - матрица (N+1)x(N+1) времени пути в минутах; 0 — депо, 1..N — заказы.
      - "order_created_offset": List[int] - длина N, минуты от текущего времени до создания заказа.
      - "order_ready_offset": List[int] - длина N, минуты до готовности заказа.
      - "boxes_per_order": List[int] - длина N, количество коробок на заказ.
      - "courier_available_offset": List[int] - длина K, минуты до доступности курьера k.
      - "courier_capacity_boxes": List[int] - длина K, вместимость курьера k в коробках.
      - "W_cert": int, вес штрафа за «сертификат» (>60 минут click-to-eat).
      - "W_c2e": int, вес компоненты click-to-eat в целевой функции.
      - "W_skip": int - вес штрафа за пропуск заказа.

    Необязательные поля:
      - "time_limit": float (секунды) - лимит времени решателя (по умолчанию 15.0).
      - "workers": int - количество потоков CP-SAT (по умолчанию 8).

    -----------------------
    ВОЗВРАТ (dict)
    -----------------------
    {
      "status": str — "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN".
      "objective": int — значение целевой функции.
      "routes": List[List[int]] — маршрут каждого курьера в индексах узлов.
      "t_departure": List[int] — минуты выезда для курьеров.
      "t_delivery": Dict[int, int] — минуты доставки для заказов (ключи 1..N).
      "cert": Dict[int, int] — индикатор сертификата (1 если click-to-eat > 60).
      "skip": Dict[int, int] — 1 если заказ отложен.
      "assigned_to_courier": Dict[Tuple[int, int], int] — матрица назначений заказ–курьер.
    }

    Примечание:
    - Индексация заказов — 1..N. Узел 0 — депо.
    - Время — целые минуты. 60 минут — порог сертификата.
    """

    def __init__(self) -> None:
        self._last_cp_solver = None  # для отладки при необходимости

    def solve(self, problem: Dict[str, Any]) -> Dict[str, Any]:
        # --------
        # Чтение входа
        # --------
        tau = problem["tau"]  # (N+1)x(N+1)
        courier_capacity_boxes = list(problem["courier_capacity_boxes"])
        boxes_per_order = list(problem["boxes_per_order"])
        order_created_offset = list(problem["order_created_offset"])
        order_ready_offset = list(problem["order_ready_offset"])
        courier_available_offset = list(problem["courier_available_offset"])
        W_cert = int(problem["W_cert"])
        W_c2e = int(problem["W_c2e"])
        W_skip = int(problem.get("W_skip", W_cert))

        N = len(boxes_per_order)
        K = len(courier_available_offset)
        assert len(courier_capacity_boxes) == K, "courier_capacity_boxes must equal number of couriers"
        assert len(order_created_offset) == N and len(order_ready_offset) == N, "order offsets must have length N"
        assert len(tau) == N + 1 and all(len(row) == N + 1 for row in tau), "tau must be (N+1)x(N+1)"

        time_limit = float(problem.get("time_limit", 15.0))
        workers = int(problem.get("workers", 8))

        nodes = list(range(N + 1))      # 0..N
        orders = list(range(1, N + 1))  # 1..N
        depot = 0

        # --------
        # Оценка большого M (динамически разумная верхняя граница)
        # --------
        max_tau = max(tau[i][j] for i in nodes for j in nodes if i != j)
        # Верхняя оценка времени доставки: max(courier_available_offset_k, max order_ready_offset_i)
        # плюс запас (N+1)*max_tau
        max_courier_available = max(courier_available_offset) if courier_available_offset else 0
        max_order_ready = max(order_ready_offset) if order_ready_offset else 0
        horizon_start = max(max_courier_available, max_order_ready)
        M = horizon_start + (N + 1) * max_tau + 60  # запас к порогу сертификата
        # Для пустых входов защитимся:
        if N == 0:
            M = 60 + max(horizon_start, 0)

        model = cp_model.CpModel()

        # --------
        # ПЕРЕМЕННЫЕ
        # --------
        # assigned_to_courier[i,k] ∈ {0,1} — заказ i назначен курьеру k
        assigned_to_courier = {
            (i, k): model.NewBoolVar(f"assigned_{i}_{k}") for i in orders for k in range(K)
        }

        # y[i,j,k] ∈ {0,1} — на маршруте курьера k сразу после i идёт j
        # i,j ∈ nodes (включая depot), i != j
        y = {}
        for k in range(K):
            for i in nodes:
                for j in nodes:
                    if i != j:
                        y[(i, j, k)] = model.NewBoolVar(f"y_{i}_{j}_k{k}")

        # Время выезда t_departure[k] (целые минуты)
        # Нижнюю границу можно положить min(courier_available_offset_k), но это не обязательно
        t_departure = [model.NewIntVar(0, M, f"t_departure_{k}") for k in range(K)]

        # Время доставки t_delivery[i] (целые минуты), определено для всех i, но «включается» через назначения
        t_delivery = {i: model.NewIntVar(0, M, f"t_delivery_{i}") for i in orders}

        # cert[i] ∈ {0,1} — сертификат (click-to-eat > 60)
        cert = {i: model.NewBoolVar(f"cert_{i}") for i in orders}

        # skip[i] ∈ {0,1} — заказ i отложен на последующее планирование
        skip = {i: model.NewBoolVar(f"skip_{i}") for i in orders}

        # Бинар «использован ли курьер k» (имеет хотя бы один заказ)
        used = [model.NewBoolVar(f"used_{k}") for k in range(K)]

        # --------
        # ОГРАНИЧЕНИЯ
        # --------

        # (1) Каждый заказ либо назначен курьеру, либо помечен на пропуск
        for i in orders:
            model.Add(sum(assigned_to_courier[(i, k)] for k in range(K)) + skip[i] == 1)

        # (2) Вместимость по коробкам у каждого курьера
        for k in range(K):
            model.Add(
                sum(boxes_per_order[i - 1] * assigned_to_courier[(i, k)] for i in orders)
                <= courier_capacity_boxes[k]
            )

        # Связь used_k с assigned_to_courier: used_k == 1, если есть хотя бы один назначенный заказ
        for k in range(K):
            model.Add(sum(assigned_to_courier[(i, k)] for i in orders) >= 1).OnlyEnforceIf(used[k])
            model.Add(sum(assigned_to_courier[(i, k)] for i in orders) == 0).OnlyEnforceIf(used[k].Not())

        # (3) Доступность и готовность: t_departure_k >= courier_available_offset_k
        # и t_departure_k >= order_ready_offset_i при назначении
        for k in range(K):
            model.Add(t_departure[k] >= courier_available_offset[k])
            for i in orders:
                # t_departure_k ≥ order_ready_offset_i - M*(1 - assigned_to_courier[i,k])
                model.Add(
                    t_departure[k]
                    >= order_ready_offset[i - 1] - M * (1 - assigned_to_courier[(i, k)])
                )

        # (4) Последовательности/степени для каждого курьера на y:
        for k in range(K):
            # Если заказ i назначен курьеру k, то у i ровно один «исход» и ровно один «вход» на маршруте k
            for i in orders:
                model.Add(sum(y[(i, j, k)] for j in nodes if j != i) == assigned_to_courier[(i, k)])
                model.Add(sum(y[(j, i, k)] for j in nodes if j != i) == assigned_to_courier[(i, k)])

            # Для депо: если курьер используется, ровно один выход из депо и ровно один вход в депо.
            model.Add(sum(y[(depot, j, k)] for j in orders) == used[k])
            model.Add(sum(y[(i, depot, k)] for i in orders) == used[k])

            # Исключаем «депо→депо» и «самопетли» на всякий случай (и так запрещено i!=j)
            # (ничего не делаем — переменная не создана для i==j)

        # (4.1) Временные зависимости по дугам:
        for k in range(K):
            # depot -> i
            for i in orders:
                model.Add(
                    t_delivery[i] >= t_departure[k] + tau[depot][i] - M * (1 - y[(depot, i, k)])
                )
            # i -> j (оба — заказы)
            for i in orders:
                for j in orders:
                    if i != j:
                        model.Add(
                            t_delivery[j] >= t_delivery[i] + tau[i][j] - M * (1 - y[(i, j, k)])
                        )
            # Времени для j=depot не задаём — t_delivery[depot] не определено/не требуется.

        # (5) Сертификаты: t_delivery_i - order_created_offset_i <= 60 + M*cert_i
        for i in orders:
            model.Add(t_delivery[i] - order_created_offset[i - 1] <= 60 + M * cert[i])
            # t_delivery[i] не может быть раньше created_at (опционально; можно убрать, если не нужно)
            model.Add(t_delivery[i] >= order_created_offset[i - 1])

        # Дополнительно: чтобы t_delivery[i] было «включено» только при назначении,
        # можно связать с assigned_to_courier суммами входящих дуг (эквивалентно уже сделанным степеням).
        # Гарантия уже есть через y и big-M, поэтому лишние лайны не нужны.

        # --------
        # ЦЕЛЕВАЯ ФУНКЦИЯ
        # --------
        # minimize штрафы за сертификаты, click-to-eat и отложенные заказы
        model.Minimize(
            W_cert * sum(cert[i] for i in orders)
            + W_c2e * sum(t_delivery[i] - order_created_offset[i - 1] for i in orders)
            + W_skip * sum(skip[i] for i in orders)
        )

        # --------
        # ПАРАМЕТРЫ РЕШАТЕЛЯ
        # --------
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit
        solver.parameters.num_search_workers = workers
        # Полезно для крупных инстансов:
        solver.parameters.linearization_level = 1
        solver.parameters.cp_model_presolve = True
        solver.parameters.use_lns = True
        # solver.parameters.max_num_branches = 0  # по умолчанию без жёсткого лимита ветвлений

        self._last_cp_solver = solver
        status = solver.Solve(model)

        # --------
        # Извлечение решения
        # --------
        status_map = {
            cp_model.OPTIMAL: "OPTIMAL",
            cp_model.FEASIBLE: "FEASIBLE",
            cp_model.INFEASIBLE: "INFEASIBLE",
            cp_model.MODEL_INVALID: "MODEL_INVALID",
            cp_model.UNKNOWN: "UNKNOWN",
        }
        status_str = status_map.get(status, "UNKNOWN")

        # Если нет решения — вернём пустые маршруты и минимум метаданных
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return {
                "status": status_str,
                "objective": None,
                "routes": [[0, 0] for _ in range(K)],
                "t_departure": [None for _ in range(K)],
                "t_delivery": {},
                "cert": {},
                "assigned_to_courier": {},
            }

        # Время выезда
        t_departure_val = [int(solver.Value(t_departure[k])) for k in range(K)]

        # t_delivery и cert по заказам
        t_delivery_val = {i: int(solver.Value(t_delivery[i])) for i in orders}
        cert_val = {i: int(solver.Value(cert[i])) for i in orders}
        skip_val = {i: int(solver.Value(skip[i])) for i in orders}

        # Назначения заказов курьерам
        assigned_val = {
            (i, k): int(solver.Value(assigned_to_courier[(i, k)])) for i in orders for k in range(K)
        }

        # Восстановление маршрутов из y:
        routes: List[List[int]] = []
        for k in range(K):
            if int(solver.Value(used[k])) == 0:
                routes.append([0, 0])
                continue

            # ищем первый узел после депо
            next_from_depot = None
            for j in orders:
                if int(solver.Value(y[(depot, j, k)])) == 1:
                    next_from_depot = j
                    break

            if next_from_depot is None:
                # На случай редких расхождений — пустой
                routes.append([0, 0])
                continue

            # Проходим по дугам, пока не вернёмся в депо
            route = [0, next_from_depot]
            current = next_from_depot
            visited = set([next_from_depot])

            while True:
                # если следующая дуга ведёт в депо — завершили
                if int(solver.Value(y[(current, depot, k)])) == 1:
                    route.append(0)
                    break

                found_next = False
                for j in orders:
                    if j != current and int(solver.Value(y[(current, j, k)])) == 1:
                        route.append(j)
                        if j in visited:
                            # защита от петли (не должна происходить при корректной модели)
                            route.append(0)
                            found_next = True
                            break
                        visited.add(j)
                        current = j
                        found_next = True
                        break
                if not found_next:
                    # Если по какой-то причине не нашли продолжения — замкнёмся в депо
                    route.append(0)
                    break

            routes.append(route)

        objective_val = int(solver.ObjectiveValue())

        return {
            "status": status_str,
            "objective": objective_val,
            "routes": routes,
            "t_departure": t_departure_val,
            "t_delivery": t_delivery_val,
            "cert": cert_val,
            "skip": skip_val,
            "assigned_to_courier": assigned_val,
        }

from typing import Any, Dict, List, Tuple
from ortools.sat.python import cp_model


class Solver:
    """
    Монолитный CP-SAT решатель для задачи доставки пиццы.

    Текущее время принимается за 0 (точку отсчёта), created_at от него отсчитывается в прошлое.

    -----------------------
    ОЖИДАЕМЫЙ ФОРМАТ ПРОБЛЕМЫ (problem: dict)
    -----------------------
    Обязательные поля:
      - "tau": 2D список/матрица размера (N+1)x(N+1) времени пути в МИНУТАХ (int),
               узел 0 — депо/пиццерия, узлы 1..N — заказы.
      - "K":   int, число курьеров.
      - "C":   List[int] длины K — вместимость (в коробках) для каждого курьера k.
      - "box": List[int] длины N — число коробок для каждого заказа i (1..N).
      - "c":   List[int] длины N — created_at (в минутах, целые) для заказов i (1..N).
      - "r":   List[int] длины N — время готовности (в минутах) для заказов i (1..N),
               например r_i = tau0 + forecast_i.
      - "a":   List[int] длины K — время доступности курьера k (в минутах).
      - "W_cert": int, вес штрафа за «сертификат» (>60 минут click-to-eat).
      - "W_c2e": int, вес компоненты click-to-eat в целевой функции.
      - "W_skip": int — штраф за временный пропуск заказа.

    Необязательные поля:
      - "time_limit": float (секунды) — лимит времени решателя (по умолчанию 15.0).
      - "workers": int — число потоков (по умолчанию 8).
      - "max_route_arcs_per_courier": None|int — можно обрезать число дуг (необязательно).

    -----------------------
    ВОЗВРАТ (dict)
    -----------------------
    {
      "status": str,              # "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN"
      "objective": int,           # значение целевой функции (в минутах, с учётом W_cert)
      "routes": List[List[int]],  # для каждого курьера k: [0, i1, i2, ..., 0]
      "t_dep": List[int],         # время выезда каждого курьера k (мин)
      "T": Dict[int, int],        # время доставки заказа i (мин), i in 1..N
      "s": Dict[int, int],        # 0/1: индикатор сертификата для i
      "skip": Dict[int, int],     # 0/1: заказ отложен (1) или обслужен (0)
      "z": Dict[Tuple[int,int], int],  # назначение z[i,k] (0/1)
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
        K = int(problem["K"])
        C = list(problem["C"])
        box = list(problem["box"])
        c = list(problem["c"])
        r = list(problem["r"])
        a = list(problem["a"])
        W_cert = int(problem["W_cert"])
        W_c2e = int(problem["W_c2e"])
        W_skip = int(problem.get("W_skip", W_cert))

        assert len(C) == K, "len(C) must equal K"
        N = len(box)
        assert len(c) == N and len(r) == N, "c and r must have length N"
        assert len(a) == K, "len(a) must equal K"
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
        # Верхняя оценка времени доставки: max(a_k, max r_i) + (N+1)*max_tau
        horizon_start = max(max(a), max(r)) if N > 0 else max(a)
        M = horizon_start + (N + 1) * max_tau + 60  # запас к порогу сертификата
        # Для пустых входов защитимся:
        if N == 0:
            M = 60 + max(horizon_start, 0)

        model = cp_model.CpModel()

        # --------
        # ПЕРЕМЕННЫЕ
        # --------
        # z[i,k] ∈ {0,1} — заказ i назначен курьеру k
        z = {(i, k): model.NewBoolVar(f"z_{i}_{k}") for i in orders for k in range(K)}

        # y[i,j,k] ∈ {0,1} — на маршруте курьера k сразу после i идёт j
        # i,j ∈ nodes (включая depot), i != j
        y = {}
        for k in range(K):
            for i in nodes:
                for j in nodes:
                    if i != j:
                        y[(i, j, k)] = model.NewBoolVar(f"y_{i}_{j}_k{k}")

        # Время выезда t_dep[k] (целые минуты)
        # Нижнюю границу можно положить min(a_k), но это не обязательно
        t_dep = [model.NewIntVar(0, M, f"t_dep_{k}") for k in range(K)]

        # Время доставки T[i] (целые минуты), определено для всех i, но «включается» через z/y и big-M
        T = {i: model.NewIntVar(0, M, f"T_{i}") for i in orders}

        # s[i] ∈ {0,1} — сертификат (click-to-eat > 60)
        s = {i: model.NewBoolVar(f"s_{i}") for i in orders}

        # skip[i] ∈ {0,1} — заказ i отложен на последующее планирование
        skip = {i: model.NewBoolVar(f"skip_{i}") for i in orders}

        # Бинар «использован ли курьер k» (имеет хотя бы один заказ)
        used = [model.NewBoolVar(f"used_{k}") for k in range(K)]

        # --------
        # ОГРАНИЧЕНИЯ
        # --------

        # (1) Каждый заказ либо назначен курьеру, либо помечен на пропуск
        for i in orders:
            model.Add(sum(z[(i, k)] for k in range(K)) + skip[i] == 1)

        # (2) Вместимость по коробкам у каждого курьера
        for k in range(K):
            model.Add(sum(box[i - 1] * z[(i, k)] for i in orders) <= C[k])

        # Связь used_k с z: used_k == 1, если есть хотя бы один назначенный заказ
        for k in range(K):
            model.Add(sum(z[(i, k)] for i in orders) >= 1).OnlyEnforceIf(used[k])
            model.Add(sum(z[(i, k)] for i in orders) == 0).OnlyEnforceIf(used[k].Not())

        # (3) Доступность и готовность: t_dep_k >= a_k, и t_dep_k >= r_i если i назначен курьеру k
        for k in range(K):
            model.Add(t_dep[k] >= a[k])
            for i in orders:
                # t_dep_k ≥ r_i - M*(1 - z[i,k])
                model.Add(t_dep[k] >= r[i - 1] - M * (1 - z[(i, k)]))

        # (4) Последовательности/степени для каждого курьера на y:
        for k in range(K):
            # Если заказ i назначен курьеру k, то у i ровно один «исход» и ровно один «вход» на маршруте k
            for i in orders:
                model.Add(sum(y[(i, j, k)] for j in nodes if j != i) == z[(i, k)])
                model.Add(sum(y[(j, i, k)] for j in nodes if j != i) == z[(i, k)])

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
                    T[i] >= t_dep[k] + tau[depot][i] - M * (1 - y[(depot, i, k)])
                )
            # i -> j (оба — заказы)
            for i in orders:
                for j in orders:
                    if i != j:
                        model.Add(
                            T[j] >= T[i] + tau[i][j] - M * (1 - y[(i, j, k)])
                        )
            # Времени для j=depot не задаём — T[depot] не определено/не требуется.

        # (5) Сертификаты: T_i - c_i <= 60 + M*s_i
        for i in orders:
            model.Add(T[i] - c[i - 1] <= 60 + M * s[i])
            # T[i] не может быть раньше created_at (опционально; можно убрать, если не нужно)
            model.Add(T[i] >= c[i - 1])

        # Дополнительно: чтобы T[i] было «включено» только при назначении,
        # можно связать с z суммами входящих дуг (эквивалентно уже сделанным степеням).
        # Гарантия уже есть через y и big-M, поэтому лишние лайны не нужны.

        # --------
        # ЦЕЛЕВАЯ ФУНКЦИЯ
        # --------
        # minimize штрафы за сертификаты, click-to-eat и отложенные заказы
        model.Minimize(
            W_cert * sum(s[i] for i in orders)
            + W_c2e * sum(T[i] - c[i - 1] for i in orders)
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
                "t_dep": [None for _ in range(K)],
                "T": {},
                "s": {},
                "z": {},
            }

        # Время выезда
        t_dep_val = [int(solver.Value(t_dep[k])) for k in range(K)]

        # T и s по заказам
        T_val = {i: int(solver.Value(T[i])) for i in orders}
        s_val = {i: int(solver.Value(s[i])) for i in orders}
        skip_val = {i: int(solver.Value(skip[i])) for i in orders}

        # z по назначениям
        z_val = {(i, k): int(solver.Value(z[(i, k)])) for i in orders for k in range(K)}

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
            "t_dep": t_dep_val,
            "T": T_val,
            "s": s_val,
            "skip": skip_val,
            "z": z_val,
        }

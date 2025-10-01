from ortools.sat.python import cp_model
from typing import Any
import math

class VRPSolverCP:
    def __init__(self):
        self.model = None

    def solve(self, problem: dict[str, Any], time_limit_seconds: float = 10.0):
        D = problem["D"]            # distance matrix (for probeg)
        T = problem.get("T", D)    # travel time matrix (minutes)
        K = problem["K"]           # number of possible trips (vehicles × trips)
        depot = problem["depot"]
        boxes = problem["boxes"]   # demand in boxes per node
        creation = problem["creation"]  # creation times (minutes)
        ready = problem["ready"]        # ready times (minutes)
        service = problem.get("service", [0]*len(D))  # service times
        capacity = problem.get("capacity", 24)

        n = len(D)
        assert n == len(T) == len(boxes) == len(creation) == len(ready)

        model = cp_model.CpModel()

        # horizon (big M for times) — немного больше максимального разумного времени
        max_travel = max(max(row) for row in T)
        max_creation = max(creation)
        horizon = int(max_creation + (n + 5) * max_travel + 240)  # запас

        # x[k,i,j] = 1, если рейс k идет i -> j
        x = {}
        for k in range(K):
            for i in range(n):
                for j in range(n):
                    if i != j:
                        x[(k, i, j)] = model.NewBoolVar(f"x_k{k}_i{i}_j{j}")

        # assign[k,i] = 1 если рейс k посещает i (входящее ребро для i на k)
        assign = {}
        for k in range(K):
            for i in range(n):
                if i == depot: continue
                assign[(k, i)] = model.NewBoolVar(f"assign_k{k}_i{i}")

        # arrival time arr[k,i] (minutes) — только для i != depot
        arr = {}
        for k in range(K):
            for i in range(n):
                if i == depot: continue
                arr[(k, i)] = model.NewIntVar(0, horizon, f"arr_k{k}_i{i}")

        # Flow constraints: каждый клиент i != depot посещается ровно 1 раз (всех рейсах)
        for i in range(n):
            if i == depot: continue
            model.Add(sum(x[(k, j, i)] for k in range(K) for j in range(n) if j != i) == 1)
            model.Add(sum(x[(k, i, j)] for k in range(K) for j in range(n) if j != i) == 1)

        # link assign with incoming edge on same vehicle: assign[k,i] == sum_j x[k,j,i]
        for k in range(K):
            for i in range(n):
                if i == depot: continue
                model.Add(assign[(k, i)] == sum(x[(k, j, i)] for j in range(n) if j != i))

        # Depot depart/return: each trip k may either be unused or be a closed tour:
        # allow <=1 departure and <=1 return (so trip either unused or one tour)
        for k in range(K):
            model.Add(sum(x[(k, depot, j)] for j in range(n) if j != depot) <= 1)
            model.Add(sum(x[(k, i, depot)] for i in range(n) if i != depot) <= 1)
            # also: for used trip, number of departures == number of returns (0 or 1)
            model.Add(sum(x[(k, depot, j)] for j in range(n) if j != depot)
                      == sum(x[(k, i, depot)] for i in range(n) if i != depot))

        # capacity per trip k: sum boxes of nodes assigned to k <= capacity
        for k in range(K):
            model.Add(sum(boxes[i] * assign[(k, i)] for i in range(n) if i != depot) <= capacity)

        # MTZ-style positions per trip to eliminate subtours: u[k,i] in [0..n-1], u depot = 0
        u = {}
        for k in range(K):
            for i in range(n):
                if i == depot:
                    u[(k, i)] = model.NewIntVar(0, 0, f"u_k{k}_i{ i }_depot")
                else:
                    u[(k, i)] = model.NewIntVar(1, n-1, f"u_k{k}_i{i}")

        bigM_pos = n
        for k in range(K):
            for i in range(n):
                for j in range(n):
                    if i != j and i != depot and j != depot:
                        model.Add(u[(k, i)] + 1 <= u[(k, j)] + bigM_pos * (1 - x[(k, i, j)]))

        # Time propagation: if k goes i->j, arr_j >= arr_i + travel + service_i
        bigM_time = horizon + 1000
        for k in range(K):
            # when edge from depot -> j used, arrival at j >= travel(depot,j) (depot time = 0)
            for j in range(n):
                if j == depot: continue
                model.Add(arr[(k, j)] >= sum(T[depot][j] * x[(k, depot, j)] for _ in [0]) - bigM_time * (1 - sum(x[(k, depot, j)] for _ in [0])))
                # Note: above line is a no-op with sum on RHS; to be explicit we will link via edges below.

            # general edges
            for i in range(n):
                for j in range(n):
                    if i != j and j != depot and i != depot:
                        model.Add(arr[(k, j)] >= arr[(k, i)] + int(T[i][j]) + int(service[i]) - bigM_time * (1 - x[(k, i, j)]))

            # edges from depot to j
            for j in range(n):
                if j == depot: continue
                # if x[k, depot, j] == 1 then arr[k, j] >= ready_time of depot (0) + travel time
                model.Add(arr[(k, j)] >= int(T[depot][j]) - bigM_time * (1 - x[(k, depot, j)]))

            # edges to depot — if i->depot used, we could set arrival at depot if needed (not necessary)

            # ensure arrival respects ready times: if assigned then arr >= ready
            for i in range(n):
                if i == depot: continue
                model.Add(arr[(k, i)] >= int(ready[i]) - bigM_time * (1 - assign[(k, i)]))

        # lateness and shelf indicators:
        late_ik = {}
        shelf_ik = {}
        for k in range(K):
            for i in range(n):
                if i == depot: continue
                late_ik[(k, i)] = model.NewBoolVar(f"late_k{k}_i{i}")
                shelf_ik[(k, i)] = model.NewBoolVar(f"shelf_k{k}_i{i}")

                # link to assign: cannot be late or shelf if not assigned
                model.Add(late_ik[(k, i)] <= assign[(k, i)])
                model.Add(shelf_ik[(k, i)] <= assign[(k, i)])

                # delta_late = arr - (creation + 60)
                delta_late = model.NewIntVar(-bigM_time, bigM_time, f"delta_late_k{k}_i{i}")
                model.Add(delta_late == arr[(k, i)] - int(creation[i] + 60))
                # late_ik == 1 => delta_late >= 1
                model.Add(delta_late >= 1).OnlyEnforceIf(late_ik[(k, i)])
                # not late => delta_late <= 0
                model.Add(delta_late <= 0).OnlyEnforceIf(late_ik[(k, i)].Not())

                # delta_shelf = arr - ready - 15
                delta_shelf = model.NewIntVar(-bigM_time, bigM_time, f"delta_shelf_k{k}_i{i}")
                model.Add(delta_shelf == arr[(k, i)] - int(ready[i] + 15))
                model.Add(delta_shelf >= 1).OnlyEnforceIf(shelf_ik[(k, i)])
                model.Add(delta_shelf <= 0).OnlyEnforceIf(shelf_ik[(k, i)].Not())

        # aggregate per-order late and shelf (order visited by exactly one k)
        late_i = {}
        shelf_i = {}
        for i in range(n):
            if i == depot: continue
            late_i[i] = model.NewBoolVar(f"late_i{i}")
            shelf_i[i] = model.NewBoolVar(f"shelf_i{i}")
            model.Add(late_i[i] == sum(late_ik[(k, i)] for k in range(K)))
            model.Add(shelf_i[i] == sum(shelf_ik[(k, i)] for k in range(K)))

        # objective components
        num_late = sum(late_i[i] for i in range(n) if i != depot)
        total_delivery_time = sum((arr[(k, i)] - int(creation[i])) * assign[(k, i)]
                                  for k in range(K) for i in range(n) if i != depot)
        num_shelf = sum(shelf_i[i] for i in range(n) if i != depot)
        total_dist = sum(int(D[i][j]) * x[(k, i, j)] for k in range(K) for i in range(n) for j in range(n) if i != j)

        # Weighted lexicographic approximation: choose large weights
        W1 = 10**9   # primary: number of late deliveries
        W2 = 10**5   # secondary: total delivery time (minutes)
        W3 = 10**3   # tertiary: number of shelf > 15
        W4 = 1       # last: distance/probeg

        objective = W1 * num_late + W2 * total_delivery_time + W3 * num_shelf + W4 * total_dist
        model.Minimize(objective)

        # solver parameters
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit_seconds
        solver.parameters.num_search_workers = 8

        status = solver.Solve(model)

        routes = []
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            # extract routes per k
            for k in range(K):
                # find start: depot -> j
                start = None
                for j in range(n):
                    if j == depot: continue
                    v = x[(k, depot, j)]
                    if solver.Value(v) == 1:
                        start = j
                        break
                if start is None:
                    routes.append([depot, depot])
                    continue

                route = [depot, start]
                current = start
                visited = set([start])
                while True:
                    found = False
                    for j in range(n):
                        if j == current: continue
                        if solver.Value(x[(k, current, j)]) == 1:
                            route.append(j)
                            if j != depot:
                                visited.add(j)
                            current = j
                            found = True
                            break
                    if not found or current == depot:
                        break

                routes.append(route)
        else:
            # fallback: empty trips
            routes = [[depot, depot] for _ in range(K)]

        # trim to only used routes if desired:
        return routes

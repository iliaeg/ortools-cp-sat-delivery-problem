from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Tuple, TYPE_CHECKING

from ortools.sat.python import cp_model
from google.protobuf.json_format import MessageToDict

if TYPE_CHECKING:  # pragma: no cover - import for typing only
    from .solver import CPData

@dataclass(frozen=True)
class ModelArtifacts:
    model: cp_model.CpModel
    # x: cp_model.IntVar
    # y: cp_model.IntVar
    # z: cp_model.IntVar


def _hhmmss_to_minutes(value: str) -> int:
    timestamp = datetime.strptime(value, "%H:%M:%S")
    total_seconds = timestamp.hour * 3600 + timestamp.minute * 60 + timestamp.second
    return total_seconds // 60


def build_cp_sat_model(data: "CPData") -> str: #ModelArtifacts:
    """Solve the sample CP-SAT optimization problem from Google OR-Tools docs."""
    _ = data  # placeholder to keep signature compatible for future parameters

    model = cp_model.CpModel()

    # x = model.NewBoolVar("x")
    # y = model.NewBoolVar("y")
    # z = model.NewBoolVar("z")

    # model.Add(x + 2 * y + 3 * z <= 4)
    # model.Maximize(x + 2 * y + 3 * z)

### подготовка данных

    orders = data.orders
    order_count = len(orders)

    if order_count == 0:
        return {}

    nodes = list(range(order_count + 1))  # 0 represents the kitchen
    order_nodes = nodes[1:]
    couriers = list(range(len(data.couriers)))
    travel_times = data.travel_time.matrix

    current_time_minutes = _hhmmss_to_minutes(data.current_time_utc)
    ready_times = [current_time_minutes + order.prep_duration_left_minutes for order in orders]
    horizon = 24 * 60 * 2

### минимизация длины маршрута

    arcs: Dict[Tuple[int, int, int], cp_model.IntVar] = {}
    arrival_times: Dict[Tuple[int, int], cp_model.IntVar] = {}
    for courier in couriers:
        for i in nodes:
            for j in nodes:
                if i == j:
                    continue
                arcs[(courier, i, j)] = model.NewBoolVar(f"arc_c{courier}_{i}_{j}")
        for node in nodes:
            arrival_times[(courier, node)] = model.NewIntVar(0, horizon, f"arrival_c{courier}_{node}")
        model.Add(arrival_times[(courier, 0)] == current_time_minutes)

    objective_terms = []
    for courier in couriers:
        for i in nodes:
            for j in nodes:
                if i == j:
                    continue
                cost = travel_times[i][j]
                arc_var = arcs[(courier, i, j)]
                objective_terms.append(cost * arc_var)

                model.Add(
                    arrival_times[(courier, j)]
                    >= arrival_times[(courier, i)] + travel_times[i][j] - horizon * (1 - arc_var)
                )

    model.Minimize(sum(objective_terms))

### Ограничение, что каждый заказ должен быть посещён ровно 1 раз

    incoming_by_courier: Dict[Tuple[int, int], List[cp_model.IntVar]] = defaultdict(list)
    for order_node in order_nodes:
        incoming_total: List[cp_model.IntVar] = []
        for courier in couriers:
            for i in nodes:
                if i == order_node:
                    continue
                arc_var = arcs[(courier, i, order_node)]
                incoming_total.append(arc_var)
                incoming_by_courier[(courier, order_node)].append(arc_var)
        model.Add(sum(incoming_total) == 1)

### ограничение, что заказ нельзя везти до времени его готовности

    for order_index, order_node in enumerate(order_nodes):
        ready_time = ready_times[order_index]
        for courier in couriers:
            incoming_arcs = incoming_by_courier[(courier, order_node)]
            if not incoming_arcs:
                continue
            visit = model.NewBoolVar(f"visit_c{courier}_{order_node}")
            model.Add(visit == sum(incoming_arcs))
            model.Add(arrival_times[(courier, order_node)] >= ready_time).OnlyEnforceIf(visit)

### solve

    solver = cp_model.CpSolver()
    status_code = solver.Solve(model)
    status_label = solver.StatusName(status_code)

    print(f"status_label: {status_label}")
    print(f"objective: {solver.ObjectiveValue()}")
    # for courier in couriers:
    #     for i in nodes:
    #         for j in nodes:
    #             if i == j:
    #                 continue
    #             print(f"arc_c{courier}_{i}_{j}: {solver.Value(arcs[(courier, i, j)])}")

    for courier in couriers:
        next_hop: Dict[int, int] = {}
        for i in nodes:
            for j in nodes:
                if i == j:
                    continue
                if solver.Value(arcs[(courier, i, j)]):
                    next_hop[i] = j
        route = [0]
        current = 0
        visited = set()
        while current in next_hop and current not in visited:
            visited.add(current)
            nxt = next_hop[current]
            route.append(nxt)
            current = nxt
        print(f"courier {courier} route: {' -> '.join(map(str, route))}")

    solver_dict = MessageToDict(solver.ResponseProto())

    

###

    return solver_dict

    # return ModelArtifacts(
    #     model=model)

from __future__ import annotations

from dataclasses import dataclass
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
        return ModelArtifacts(model=model, arcs={}, ranks={}, nodes=[0], order_nodes=[], couriers=[])

    nodes = list(range(order_count + 1))  # 0 represents the kitchen
    order_nodes = nodes[1:]
    couriers = list(range(len(data.couriers)))
    travel_times = data.travel_time.matrix

### минимизация длины маршрута

    arcs: Dict[Tuple[int, int, int], cp_model.IntVar] = {}
    for courier in couriers:
        for i in nodes:
            for j in nodes:
                if i == j:
                    continue
                arcs[(courier, i, j)] = model.NewBoolVar(f"arc_c{courier}_{i}_{j}")

    objective_terms = []
    for courier in couriers:
        for i in nodes:
            for j in nodes:
                if i == j:
                    continue
                cost = travel_times[i][j]
                arc_var = arcs[(courier, i, j)]
                objective_terms.append(cost * arc_var)

    model.Minimize(sum(objective_terms))

### Ограничение, что каждый заказ должен быть посещён ровно 1 раз

    for order_node in order_nodes:
        incoming = []
        for courier in couriers:
            for i in nodes:
                if i == order_node:
                    continue
                incoming.append(arcs[(courier, i, order_node)])
        model.Add(sum(incoming) == 1)

### ограничение, что заказ нельзя везти до времени


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

    solver_dict = MessageToDict(solver.ResponseProto())

    # print(solver_dict)
    
    # model.Maximize(x + 2 * y + 3 * z)

###

    return solver_dict

    # return ModelArtifacts(
    #     model=model)

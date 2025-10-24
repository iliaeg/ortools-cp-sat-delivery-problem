from __future__ import annotations

from fastapi.testclient import TestClient
import pytest

from order_grouping.api import app
from order_grouping.domain_mapping import DomainSolveRequest, map_domain_request


@pytest.fixture
def sample_payload() -> dict:
    return {
        "current_timestamp_utc": "2024-01-01T12:00:00Z",
        "travel_time_matrix_minutes": [
            [0, 10, 12],
            [10, 0, 4],
            [12, 4, 0],
        ],
        "orders": [
            {
                "order_id": "o-1",
                "boxes_count": 1,
                "created_at_utc": "2024-01-01T11:45:00Z",
                "expected_ready_at_utc": "2024-01-01T12:05:00Z",
            },
            {
                "order_id": "o-2",
                "boxes_count": 2,
                "created_at_utc": "2024-01-01T11:50:00Z",
                "expected_ready_at_utc": "2024-01-01T12:10:00Z",
            },
        ],
        "couriers": [
            {
                "courier_id": "c-1",
                "box_capacity": 3,
                "expected_courier_return_at_utc": "2024-01-01T12:00:00Z",
            }
        ],
        "optimization_weights": {
            "certificate_penalty_weight": 100,
            "click_to_eat_penalty_weight": 1,
            "skip_order_penalty_weight": 200,
        },
    }


def test_domain_payload_mapping(sample_payload: dict) -> None:
    request_model = DomainSolveRequest(**sample_payload)
    mapped = map_domain_request(request_model)

    assert mapped["tau"] == sample_payload["travel_time_matrix_minutes"]
    assert "K" not in mapped
    assert mapped["courier_capacity_boxes"] == [3]
    assert mapped["boxes_per_order"] == [1, 2]
    assert mapped["order_created_offset"] == [-15, -10]
    assert mapped["order_ready_offset"] == [5, 10]
    assert mapped["courier_available_offset"] == [0]
    assert mapped["W_cert"] == 100
    assert mapped["W_c2e"] == 1
    assert mapped["W_skip"] == 200


def test_mapping_allows_ready_before_created(sample_payload: dict) -> None:
    payload = sample_payload
    payload["orders"][0]["created_at_utc"] = "2024-01-01T11:50:00Z"
    payload["orders"][0]["expected_ready_at_utc"] = "2024-01-01T11:40:00Z"

    request_model = DomainSolveRequest(**payload)
    mapped = map_domain_request(request_model)

    assert mapped["order_ready_offset"][0] == -20
    assert mapped["order_created_offset"][0] == -10


def test_solve_domain_endpoint(sample_payload: dict) -> None:
    client = TestClient(app)

    response = client.post("/solve", json=sample_payload)

    assert response.status_code == 200
    body = response.json()

    assert body["status"] == "OPTIMAL"
    assert body["current_timestamp_utc"] == sample_payload["current_timestamp_utc"]

    couriers = {plan["courier_id"]: plan for plan in body["couriers"]}
    assert set(couriers.keys()) == {"c-1"}

    courier_plan = couriers["c-1"]
    assert courier_plan["planned_departure_at_utc"] == "2024-01-01T12:10:00Z"
    assert courier_plan["planned_return_at_utc"] == "2024-01-01T12:36:00Z"
    assert courier_plan["delivery_sequence"] == [
        {"position": 1, "order_id": "o-1"},
        {"position": 2, "order_id": "o-2"},
    ]

    orders = {order["order_id"]: order for order in body["orders"]}
    assert set(orders.keys()) == {"o-1", "o-2"}

    assert orders["o-1"] == {
        "order_id": "o-1",
        "assigned_courier_id": "c-1",
        "planned_delivery_at_utc": "2024-01-01T12:20:00Z",
        "is_cert": False,
        "is_skipped": False,
    }
    assert orders["o-2"] == {
        "order_id": "o-2",
        "assigned_courier_id": "c-1",
        "planned_delivery_at_utc": "2024-01-01T12:24:00Z",
        "is_cert": False,
        "is_skipped": False,
    }

    assert body["metrics"] == {
        "total_orders": 2,
        "assigned_orders": 2,
        "total_couriers": 1,
        "assigned_couriers": 1,
        "objective_value": 69,
    }

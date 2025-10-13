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

    assert body["meta"]["order_ids"] == ["o-1", "o-2"]
    assert body["meta"]["courier_ids"] == ["c-1"]
    assert body["meta"]["order_index_by_id"] == {"o-1": 1, "o-2": 2}

    routes = body["result"]["routes"]
    assert len(routes) == 1
    assert routes[0][0] == 0
    assert routes[0][-1] == 0
    delivered_orders = [node for node in routes[0] if node != 0]
    assert sorted(delivered_orders) == [1, 2]

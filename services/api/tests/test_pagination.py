from unittest.mock import MagicMock

from boto3.dynamodb.conditions import ConditionBase

from homehub_api.store import HubStore


def test_list_devices_returns_next_cursor(monkeypatch) -> None:
    table = MagicMock()
    table.query.side_effect = [
        {
            "Items": [
                {
                    "PK": "HOUSEHOLD#demo",
                    "SK": "DEVICE#dev-1",
                    "deviceId": "dev-1",
                    "name": "One",
                    "type": "environmental-sensor",
                    "location": "Hall",
                    "status": "UNKNOWN",
                    "lifecycleStatus": "READY",
                    "createdAt": "2026-01-01T00:00:00.000000Z",
                    "updatedAt": "2026-01-01T00:00:00.000000Z",
                }
            ],
            "LastEvaluatedKey": {"PK": "HOUSEHOLD#demo", "SK": "DEVICE#dev-1"},
        },
        {"Items": [], "LastEvaluatedKey": None},
    ]

    resource = MagicMock()
    resource.Table.return_value = table
    monkeypatch.setattr("homehub_api.store.boto3.resource", lambda _service: resource)

    store = HubStore("test-table", tenant_pk="HOUSEHOLD#demo")
    first_page = store.list_devices(limit=1)
    assert len(first_page.items) == 1
    assert first_page.next_cursor

    second_page = store.list_devices(limit=1, cursor=first_page.next_cursor)
    assert second_page.items == []
    assert second_page.next_cursor is None

    second_call = table.query.call_args_list[1].kwargs
    assert isinstance(second_call["KeyConditionExpression"], ConditionBase)
    assert second_call["Limit"] == 1
    assert second_call["ExclusiveStartKey"] == {"PK": "HOUSEHOLD#demo", "SK": "DEVICE#dev-1"}
    assert "ExpressionAttributeValues" not in second_call

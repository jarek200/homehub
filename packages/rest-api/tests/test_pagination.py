from unittest.mock import MagicMock

from homehub_api.store import HubStore


def test_list_devices_returns_next_cursor(monkeypatch) -> None:
    table = MagicMock()
    table.query.side_effect = [
        {
            "Items": [
                {
                    "PK": "HUB#demo",
                    "SK": "DEVICE#dev-1",
                    "deviceId": "dev-1",
                    "name": "One",
                    "type": "heat-alarm",
                    "location": "Hall",
                    "status": "UNKNOWN",
                    "lifecycleStatus": "READY",
                    "createdAt": "2026-01-01T00:00:00.000000Z",
                    "updatedAt": "2026-01-01T00:00:00.000000Z",
                }
            ],
            "LastEvaluatedKey": {"PK": "HUB#demo", "SK": "DEVICE#dev-1"},
        },
        {"Items": [], "LastEvaluatedKey": None},
    ]

    resource = MagicMock()
    resource.Table.return_value = table
    monkeypatch.setattr("homehub_api.store.boto3.resource", lambda _service: resource)

    store = HubStore("test-table", tenant_pk="HUB#demo")
    first_page = store.list_devices(limit=1)
    assert len(first_page.items) == 1
    assert first_page.next_cursor

    second_page = store.list_devices(limit=1, cursor=first_page.next_cursor)
    assert second_page.items == []
    assert second_page.next_cursor is None

    table.query.assert_called_with(
        KeyConditionExpression="PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues={":pk": "HUB#demo", ":sk": "DEVICE#"},
        Limit=1,
        ExclusiveStartKey={"PK": "HUB#demo", "SK": "DEVICE#dev-1"},
    )

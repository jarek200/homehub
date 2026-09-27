from homehub_api.iot import household_events as publisher


def test_handler_reports_partial_batch_failures(monkeypatch) -> None:
    monkeypatch.setattr(publisher, "publish_household_event", lambda channel, payload: None)
    event = {
        "Records": [
            {
                "eventID": "ok-1",
                "eventName": "MODIFY",
                "dynamodb": {
                    "Keys": {"PK": {"S": "HOUSEHOLD#user-1"}, "SK": {"S": "HUB_STATE"}},
                    "NewImage": {
                        "PK": {"S": "HOUSEHOLD#user-1"},
                        "SK": {"S": "HUB_STATE"},
                        "state": {"M": {"scene": {"S": "home"}, "updatedAt": {"S": "now"}}},
                    },
                },
            },
            {
                "eventID": "bad-1",
                "eventName": "MODIFY",
                "dynamodb": {
                    "Keys": {"PK": {"S": "HOUSEHOLD#user-2"}, "SK": {"S": "HUB_STATE"}},
                    "NewImage": {
                        "PK": {"S": "HOUSEHOLD#user-2"},
                        "SK": {"S": "HUB_STATE"},
                        "state": {"M": {"scene": {"S": "away"}}},
                    },
                },
            },
        ]
    }

    def fail_second(channel: str, payload: dict) -> None:
        if channel.endswith("user-2"):
            raise RuntimeError("publish failed")

    monkeypatch.setattr(publisher, "publish_household_event", fail_second)
    result = publisher.handler(event, None)
    assert result["batchItemFailures"] == [{"itemIdentifier": "bad-1"}]


def test_handler_skips_non_state_records(monkeypatch) -> None:
    called = []
    monkeypatch.setattr(
        publisher, "publish_household_event", lambda channel, payload: called.append(channel)
    )
    result = publisher.handler(
        {
            "Records": [
                {
                    "eventID": "plan-1",
                    "eventName": "MODIFY",
                    "dynamodb": {
                        "Keys": {"PK": {"S": "HOUSEHOLD#user-1"}, "SK": {"S": "FLOOR_PLAN"}}
                    },
                }
            ]
        },
        None,
    )
    assert called == []
    assert result["batchItemFailures"] == []

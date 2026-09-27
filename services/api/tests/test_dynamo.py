from boto3.dynamodb.conditions import Key

from homehub_api.dynamo import set_update, sk_begins_with, sk_between


def test_set_update_builds_named_placeholders() -> None:
    result = set_update({"status": "ONLINE", "updatedAt": "t"})

    assert result["UpdateExpression"] == "SET #status = :status, #updatedAt = :updatedAt"
    assert result["ExpressionAttributeNames"] == {
        "#status": "status",
        "#updatedAt": "updatedAt",
    }
    assert result["ExpressionAttributeValues"] == {
        ":status": "ONLINE",
        ":updatedAt": "t",
    }


def test_sk_begins_with_matches_key_condition() -> None:
    expected = Key("PK").eq("HOUSEHOLD#demo") & Key("SK").begins_with("DEVICE#")
    assert sk_begins_with("HOUSEHOLD#demo", "DEVICE#").get_expression() == expected.get_expression()


def test_sk_between_matches_key_condition() -> None:
    expected = Key("PK").eq("HOUSEHOLD#demo") & Key("SK").between("EVENT#a", "EVENT#z")
    assert (
        sk_between("HOUSEHOLD#demo", "EVENT#a", "EVENT#z").get_expression()
        == expected.get_expression()
    )

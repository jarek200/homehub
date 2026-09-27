import jwt
from fastapi.testclient import TestClient

from homehub_api.fake_store import FakeHubStore
from homehub_api.main import create_app


def auth_headers(sub: str = "user-1") -> dict[str, str]:
    token = jwt.encode({"sub": sub}, "test", algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


class AuthedClient:
    def __init__(self, store: FakeHubStore | None = None) -> None:
        self.store = store or FakeHubStore()
        self._client = TestClient(create_app(store=self.store))
        self._headers = auth_headers()

    def __enter__(self) -> "AuthedClient":
        self._client.__enter__()
        return self

    def __exit__(self, *args: object) -> None:
        self._client.__exit__(*args)

    def get(self, url: str, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        return self._client.get(url, headers=headers, **kwargs)

    def post(self, url: str, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        return self._client.post(url, headers=headers, **kwargs)

    def put(self, url: str, **kwargs):
        headers = {**self._headers, **kwargs.pop("headers", {})}
        return self._client.put(url, headers=headers, **kwargs)


def client() -> AuthedClient:
    return AuthedClient()


def test_household_state_defaults() -> None:
    with client() as test_client:
        response = test_client.get("/household/state")
        assert response.status_code == 200
        state = response.json()["state"]
        assert state["lock"] is None
        assert any(light["id"] == "matter-1" and light["on"] for light in state["lights"])
        assert state["leaks"][0]["id"] == "matter-7"
        assert [plug["id"] for plug in state["plugs"]] == ["matter-9", "matter-10"]


def test_household_lock_house_command_without_lock() -> None:
    with client() as test_client:
        test_client.post("/household/commands", json={"command": "unlock-house"})
        response = test_client.post("/household/commands", json={"command": "lock-house"})
        assert response.status_code == 200
        assert response.json()["state"]["lock"] is None


def test_household_all_lights_off() -> None:
    with client() as test_client:
        response = test_client.post("/household/commands", json={"command": "all-lights-off"})
        assert response.status_code == 200
        assert all(not light["on"] for light in response.json()["state"]["lights"])


def test_household_away_scene_keeps_lights() -> None:
    with client() as test_client:
        response = test_client.post("/household/commands", json={"command": "away"})
        state = response.json()["state"]
        assert state["scene"] == "away"
        assert all(light["on"] for light in state["lights"])


def test_household_home_scene_keeps_lights() -> None:
    with client() as test_client:
        test_client.post("/household/commands", json={"command": "away"})
        response = test_client.post("/household/commands", json={"command": "home"})
        state = response.json()["state"]
        assert state["scene"] == "home"
        assert all(light["on"] for light in state["lights"])


def test_household_all_plugs_off() -> None:
    with client() as test_client:
        response = test_client.post("/household/commands", json={"command": "all-plugs-off"})
        state = response.json()["state"]
        assert all(not plug["on"] for plug in state["plugs"])
        assert all(light["on"] for light in state["lights"])


def test_household_evening_scene() -> None:
    with client() as test_client:
        response = test_client.post("/household/commands", json={"command": "evening"})
        state = response.json()["state"]
        assert state["scene"] == "evening"
        assert state["lock"] is None
        kajplats = next(light for light in state["lights"] if light["id"] == "matter-1")
        assert kajplats["on"] is True
        assert kajplats["brightness"] == 40


def test_household_rules_roundtrip() -> None:
    with client() as test_client:
        payload = {
            "rules": [
                {
                    "name": "Hot Living Room",
                    "condition": {
                        "device": "living-room-temperature",
                        "property": "temperature",
                        "operator": ">",
                        "value": 26,
                    },
                    "action": {"device": "living-room-fan", "command": "on"},
                    "hysteresis": 2,
                }
            ]
        }
        put = test_client.put("/household/rules", json=payload)
        assert put.status_code == 200
        get = test_client.get("/household/rules")
        assert get.status_code == 200
        assert get.json()["rules"][0]["name"] == "Hot Living Room"


def test_household_plan_roundtrip() -> None:
    with client() as test_client:
        empty = test_client.get("/household/plan")
        assert empty.status_code == 200
        assert empty.json()["plan"] is None
        assert empty.headers.get("cache-control") == "no-store"

        payload = {
            "plan": {
                "id": "home",
                "name": "Kitchen",
                "width": 800,
                "height": 600,
                "rooms": [
                    {"id": "kitchen", "name": "Kitchen", "x": 40, "y": 40, "w": 200, "h": 160}
                ],
                "doors": [],
                "windows": [],
                "sensors": [],
            }
        }
        put = test_client.put("/household/plan", json=payload)
        assert put.status_code == 200
        assert put.json()["plan"]["name"] == "Kitchen"

        get = test_client.get("/household/plan")
        assert get.json()["plan"]["rooms"][0]["name"] == "Kitchen"
        assert get.json()["library"] is None


def test_household_plan_library_roundtrip() -> None:
    with client() as test_client:
        home_a = {
            "id": "home_a",
            "name": "Home A",
            "width": 800,
            "height": 600,
            "rooms": [{"id": "kitchen", "name": "Kitchen", "x": 40, "y": 40, "w": 200, "h": 160}],
            "doors": [],
            "windows": [],
            "sensors": [],
        }
        home_b = {
            "id": "home_b",
            "name": "Home B",
            "width": 1000,
            "height": 740,
            "rooms": [],
            "doors": [],
            "windows": [],
            "sensors": [],
        }
        payload = {
            "plan": home_b,
            "library": {"activePlanId": "home_b", "plans": [home_a, home_b]},
        }
        put = test_client.put("/household/plan", json=payload)
        assert put.status_code == 200
        assert put.json()["plan"]["name"] == "Home B"
        assert [plan["name"] for plan in put.json()["library"]["plans"]] == ["Home A", "Home B"]

        get = test_client.get("/household/plan")
        assert get.json()["plan"]["id"] == "home_b"
        assert get.json()["library"]["activePlanId"] == "home_b"
        assert get.json()["library"]["plans"][0]["name"] == "Home A"


def test_household_plan_accepts_float_coordinates() -> None:
    with client() as test_client:
        payload = {
            "plan": {
                "id": "home",
                "name": "Kitchen",
                "width": 1000,
                "height": 740,
                "rooms": [
                    {"id": "kitchen", "name": "Kitchen", "x": 40.5, "y": 40, "w": 200, "h": 160}
                ],
                "doors": [
                    {
                        "id": "d1",
                        "name": "Door",
                        "x": 646.8878784179688,
                        "y": 280,
                        "wall": "n",
                        "length": 20,
                    }
                ],
                "windows": [],
                "sensors": [],
            }
        }
        put = test_client.put("/household/plan", json=payload)
        assert put.status_code == 200
        assert put.json()["plan"]["doors"][0]["x"] == 646.8878784179688


def test_household_rejects_unknown_command() -> None:
    with client() as test_client:
        response = test_client.post("/household/commands", json={"command": "explode"})
        assert response.status_code == 400


def test_household_device_turns_light_off() -> None:
    with client() as test_client:
        response = test_client.post(
            "/household/device", json={"kind": "light", "id": "matter-1", "on": False}
        )
        assert response.status_code == 200
        light = next(
            item for item in response.json()["state"]["lights"] if item["id"] == "matter-1"
        )
        assert light["on"] is False
        other = next(
            item for item in response.json()["state"]["lights"] if item["id"] == "matter-11"
        )
        assert other["on"] is True


def test_household_device_sets_brightness() -> None:
    with client() as test_client:
        response = test_client.post(
            "/household/device", json={"kind": "light", "id": "matter-1", "brightness": 40}
        )
        assert response.status_code == 200
        light = next(
            item for item in response.json()["state"]["lights"] if item["id"] == "matter-1"
        )
        assert light["on"] is True
        assert light["brightness"] == 40


def test_household_device_turns_second_plug_off() -> None:
    with client() as test_client:
        response = test_client.post(
            "/household/device", json={"kind": "plug", "id": "matter-10", "on": False}
        )
        assert response.status_code == 200
        plugs = {item["id"]: item["on"] for item in response.json()["state"]["plugs"]}
        assert plugs["matter-10"] is False
        assert plugs["matter-9"] is True


def test_household_device_rejects_empty_action() -> None:
    with client() as test_client:
        response = test_client.post("/household/device", json={"kind": "light", "id": "matter-1"})
        assert response.status_code == 400

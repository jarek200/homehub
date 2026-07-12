"""Demo tenant seed data for first DynamoDB deploy."""

from homehub_api.models import DeviceResponse

DEMO_TIMESTAMP = "2026-07-10T14:22:10.000Z"

DEMO_DEVICES: list[DeviceResponse] = [
    DeviceResponse(
        deviceId="dummy-hallway-smoke-alarm",
        name="Hallway Smoke Alarm",
        type="smoke-alarm",
        location="Hallway",
        status="ONLINE",
        lifecycleStatus="READY",
        thingName="homehub-dummy-hallway-smoke-alarm",
        configuration=(
            '{"model":"Ei3016","series":"3000","interconnect":"RadioLINK+",'
            '"opticalSensor":true,"testIntervalDays":30}'
        ),
        lastSeenAt=DEMO_TIMESTAMP,
        createdAt=DEMO_TIMESTAMP,
        updatedAt=DEMO_TIMESTAMP,
    ),
    DeviceResponse(
        deviceId="dummy-kitchen-heat-alarm",
        name="Kitchen Heat Alarm",
        type="heat-alarm",
        location="Kitchen",
        status="ONLINE",
        lifecycleStatus="READY",
        thingName="homehub-dummy-kitchen-heat-alarm",
        configuration=(
            '{"model":"Ei3014","series":"3000","fixedTemperatureC":58,"rateOfRise":true}'
        ),
        lastSeenAt="2026-07-10T14:18:00.000Z",
        createdAt=DEMO_TIMESTAMP,
        updatedAt=DEMO_TIMESTAMP,
    ),
    DeviceResponse(
        deviceId="dummy-landing-co-alarm",
        name="Landing CO Alarm",
        type="carbon-monoxide-alarm",
        location="Landing",
        status="ONLINE",
        lifecycleStatus="READY",
        thingName="homehub-dummy-landing-co-alarm",
        configuration=(
            '{"model":"Ei3018","series":"3000","coThresholdPpm":50,"sensorLifeYears":10}'
        ),
        lastSeenAt="2026-07-10T14:15:00.000Z",
        createdAt=DEMO_TIMESTAMP,
        updatedAt=DEMO_TIMESTAMP,
    ),
    DeviceResponse(
        deviceId="dummy-bedroom-env-sensor",
        name="Bedroom Environmental Sensor",
        type="environmental-sensor",
        location="Bedroom",
        status="ONLINE",
        lifecycleStatus="READY",
        thingName="homehub-dummy-bedroom-env-sensor",
        configuration=(
            '{"model":"Ei1020","series":"1000","reportingIntervalSeconds":300,'
            '"temperatureAlertThreshold":28,"humidityAlertThreshold":70}'
        ),
        lastSeenAt="2026-07-10T14:10:00.000Z",
        createdAt=DEMO_TIMESTAMP,
        updatedAt=DEMO_TIMESTAMP,
    ),
]

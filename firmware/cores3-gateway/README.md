# CoreS3 Matter / Thread gateway

ESP-IDF firmware for the M5Stack CoreS3 Thread BR (K149) as a **local-first** Matter controller and Thread Border Router. AWS IoT is a mirror and remote-control path only.

ESP-IDF overlay for the M5Stack CoreS3 Thread BR (K149). Hardware notes: [HARDWARE.md](./HARDWARE.md).

- First-bulb bench notes: [BRINGUP.md](./BRINGUP.md)
- Add the next Matter device: [COMMISSIONING.md](./COMMISSIONING.md) (Cursor skill `homehub-cores3-commission`)
- How to pick the next Thread node id: [INVENTORY.md](./INVENTORY.md)

## Official starting points

1. Thread BR only: [M5Stack CoreS3 Thread BR guide](https://docs.m5stack.com/en/esp_idf/thread/module_gateway_h2/thread_border_router)
2. Matter controller + OTBR: [esp-matter/examples/controller](https://github.com/espressif/esp-matter/tree/main/examples/controller) with `sdkconfig.defaults.otbr`

Copy those examples into an ESP-IDF workspace, then overlay the files in this folder.

## CoreS3 overlay (required)

| Setting | Value |
|---|---|
| Target | `esp32s3` |
| PSRAM | Quad (`CONFIG_SPIRAM_MODE_QUAD=y`) — not Octal |
| Flash | 16 MB |
| H2 RCP UART | RX=GPIO10, TX=GPIO17, 460800 |
| Attestation | SPIFFS PAA roots in [paa_cert/](./paa_cert/) (IKEA VID `0x117C`) |
| If boot-loop | disable USB Serial JTAG console |

See [sdkconfig.defaults.cores3](./sdkconfig.defaults.cores3) and [main/esp_ot_config.h](./main/esp_ot_config.h).

## Bring-up order

1. Factory Thread BR on the K149, then `esp-matter` controller + OTBR — done, see [BRINGUP.md](./BRINGUP.md).
2. Commission devices with [COMMISSIONING.md](./COMMISSIONING.md). First KAJPLATS is node **1**.
3. Toggle OnOff locally with AWS disconnected.
4. Cursor skill `homehub-cores3-commission` runs the commissioning playbook.
5. Provision a `matter-gateway` device in HomeHub and add AWS IoT MQTT/TLS.
6. Measure `heap_caps_get_free_size(MALLOC_CAP_INTERNAL)` before adding UI or camera QR.

## Local vs cloud

```
button / sensor / CoreS3 UI  →  local Matter command
CoreS3                       →  AWS IoT state/events   (when online)
website                     →  AWS commands topic     → CoreS3 → Matter
```

Topics (gateway Thing `deviceId`):

- `homehub/gateways/{id}/state`
- `homehub/gateways/{id}/events`
- `homehub/gateways/{id}/commands`
- `homehub/gateways/{id}/config`
- `homehub/gateways/{id}/ota`

## OTA

Use the 16 MB A/B table in [partitions_16mb.csv](./partitions_16mb.csv). USB-flash that image once, then `SST_STAGE=int bash scripts/firmware/flash-cores3-ota.sh` uploads the app and publishes an HTTPS URL on `homehub/gateways/{id}/ota`. See [docs/ota.md](./docs/ota.md).

## Rules

JSON in NVS. Example: [rules.example.json](./rules.example.json). Cloud can PUT `/household/rules` and publish on `config`. Evaluate on local Matter subscriptions only.

# Gateway OTA

One pipeline: build the controller app → upload `controller.bin` to the private firmware bucket → publish a short-lived HTTPS URL on `homehub/gateways/{id}/ota` → CoreS3 writes the inactive `ota_0`/`ota_1` slot → reboot → mark valid after MQTT connects.

Do not run Matter OTA, AWS IoT Jobs OTA, and RCP OTA as three separate systems. RCP stays in `rcp_fw` unless that partition is flashed over USB.

`partitions_16mb.csv` reserves:

- `ota_0` / `ota_1` — A/B firmware
- `otadata` — which slot is active
- `rcp_fw` / `paa_cert` — H2 RCP image and IKEA PAA roots
- `nvs` at `0x9000` — fabric, Wi-Fi, registry (must survive USB flash without erase)

The first OTA-capable image still needs USB (`SST_STAGE=int bash scripts/provisioning/provision-cores3-iot.sh`). After that:

```bash
SST_STAGE=int bash scripts/firmware/flash-cores3-ota.sh
```

Rollback: if the new slot does not confirm over MQTT, the bootloader boots the previous slot.

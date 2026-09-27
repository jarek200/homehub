# Adding a BILRESA / Matter button

One HomeHub device per remote, not per paddle. Dual-button BILRESA is one `matter-N` with two Switch endpoints.

Worked example already on the fabric (11 Sep 2026): Thread **node 8**, ProductName `BILRESA dual button`. Catalog id still free: **`matter-8`** (`matter-7` is KLIPPBOK / node 9). Next physical remote after that: inventory next node / `matter-9`.

## Pair (BILRESA-specific)

- Matter-over-Thread sleepy end device. IKEA VID `0x117C`.
- **One** System-button press. Four presses is direct-to-bulb (30 s) and will not join this fabric.
- After `Commissioning success`, the USB console often disappears for a few seconds. Wait; do not run `pair` again.
- Verify only:

```text
matter esp controller read-attr <node> 0 0x0028 3    # ProductName
matter esp controller read-attr <node> 1 0x003B 0    # NumberOfPositions = 2
matter esp controller read-attr <node> 2 0x003B 0    # NumberOfPositions = 2
```

Endpoint 0 = root (Basic Information). Endpoints 1 and 2 = Generic Switch. No endpoint 3 (`0x57F`). Attribute 0 on `0x003B` is **NumberOfPositions**, not CurrentPosition. There is no OnOff load. No Matter bindings — the hub must see the press.

## Catalog spec (copy for the next remote)

```text
deviceId:    matter-8          # then matter-9, …
name:        BILRESA           # or BILRESA 2
type:        button
location:    Home
runtimeKind: matter
nodeId:      8                 # Thread node from inventory
endpoint:    1                 # first switch; second is 2
clusters:    ["switch"]
gatewayId:   cores3-gateway    # set by seed for runtimeKind=matter
```

Household object (`HubButton` in `packages/core/src/hub.ts`):

```ts
{ id: 'matter-8', name: 'BILRESA', lastPressAt: null }
```

Optional metrics (firmware `readings[]`, not required for the card): `lastEndpoint` (1 or 2), `lastEvent` (`short` / `long` / `multi`).

Add the same spec to:

- `packages/core/src/cores3-fabric.ts`
- `services/api/src/homehub_api/cores3_fabric.py` (`CORES3_FABRIC_DEVICES` **and** `buttons` in `cores3_household_state`)
- `packages/core/src/hub.ts` (`createCores3HouseholdState`)
- `packages/core/src/devices.test.ts`
- `services/api/tests/test_cores3_fabric.py`

## Firmware (required for live state)

`homehub_aws.cpp` currently does `cJSON_AddArrayToObject(state, "buttons")` with no items. The next MQTT publish **wipes** seeded `buttons`. Ship firmware that emits the same ids **before** or **with** seed.

Do **not** put Switch attributes on `kNodes` for the 60 s poll. Presses are cluster **events** on `0x003B`:

| Id | Event |
|---|---|
| 0x01 | InitialPress |
| 0x02 | LongPress |
| 0x03 | ShortRelease |
| 0x04 | LongRelease |
| 0x05 | MultiPressOngoing |
| 0x06 | MultiPressComplete |

Treat `ShortRelease` as a short press and `LongPress` / `LongRelease` as long. Ignore `InitialPress` if you also handle release (avoids double counts). `MultiPressComplete` is a multi-press.

`subscribe_command` already takes `EventPathParams`. For the button node, allocate event paths for endpoints 1 and 2, cluster `0x003B`, event `0xFFFFFFFF` (all Switch events). Keep attribute paths empty for that node. Add the node to `subscribe_live_nodes`. Do not `read_node` it in the poll loop.

Add `homehub_aws_set_button(const char *device_id, const char *name, int endpoint, const char *event)`:

- Store last ISO timestamp, endpoint, event
- Include `{id,name,lastPressAt}` in `state.buttons`
- Call `homehub_aws_notify_state_changed()` so a press publishes immediately

Stubs in `homehub_aws.c` must match new declarations in `homehub_aws.h`.

Bump `state.firmware` (today `klippbok-1`) so OTA proof is visible in Dynamo.

Heap is tight. One extra subscription is fine; do not subscribe nodes that are not on the fabric.

## Seed, deploy, OTA (order)

1. Firmware + label bump committed in the tree.
2. `SST_STAGE=int bash scripts/provisioning/seed-cores3-fabric.sh`
3. `pnpm deploy:int` via `homehub-deploy-int` (preserves the custom domain).
4. `SST_STAGE=int bash scripts/firmware/flash-cores3-ota.sh` via `homehub-cores3-ota`.
5. Poll `HUB_STATE` until `state.firmware` matches and `state.buttons[0].id` is the new `matter-N`.
6. Hard-refresh `/devices`. Press a paddle; `lastPressAt` should move. USB is not required for this check.

## Floor plan (optional)

`FLOOR_PLAN_SENSOR_KINDS` has no `button`. To place a remote on `/plan`:

- Add `'button'` to `FLOOR_PLAN_SENSOR_KINDS` and `FLOOR_PLAN_SENSOR_META` (`deviceType: 'button'`)
- `liveDevicesFor('button')` → `household.buttons` in `floor-plan-editor.svelte`
- `householdSensorStatus` for `kind === 'button'` → `PRESSED` if `lastPressAt` is within ~2 s, else `IDLE`
- Mark + status in `floor-plan-sensor-mark.svelte` / `sensor-status.ts`
- Battery: BILRESA is a battery remote; add `button` to `BATTERY_SENSOR_KINDS` only once a battery metric exists

Skip this unless the user asks to put the remote on the plan.

## Next remote

Same playbook. New Thread node. New `matter-N`. Copy the `matter-8` rows. Do not reuse node 8. Keep both remotes in `buttons[]` and in `subscribe_live_nodes`.

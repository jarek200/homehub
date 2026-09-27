# CoreS3 local live updates

This document describes the reliability improvements made to the HomeHub local page served by the CoreS3 gateway and how to test them.

## Current firmware

The current firmware label is:

```text
sns-alerts-1
```

## What was implemented

### Live state delivery

- Server-Sent Events (SSE) remain the primary path for instant device updates.
- CoreS3 sends an SSE heartbeat every 5 seconds.
- The browser treats the stream as unavailable after 10 seconds without an event or heartbeat and reconnects.
- Returning to the page after sleep, backgrounding, or focus loss triggers an immediate state refresh.

### Polling fallback

- The page polls `/state.json` every 2 seconds only while SSE is disconnected.
- Polling stops when SSE reconnects.
- Only one polling request may be active at a time.
- Each request has an 8-second timeout.
- This prevents overlapping requests from exhausting the five available HTTP sockets.

### Multiple pages

- CoreS3 supports two simultaneous SSE clients.
- Both clients receive the same state changes and heartbeats immediately.
- A third client does not evict either existing client; it uses the polling fallback.
- Two SSE clients leave three HTTP sockets available for state requests and controls.

### Matter subscription recovery

- Subscription health is tracked independently for each Matter device.
- A successful report resets that device's retry state.
- Failed or terminated subscriptions retry after 1, 2, 4, 8, and 16 seconds, then every 30 seconds.
- One failed device does not restart or interrupt subscriptions for other devices.
- The existing 60-second reconciliation read remains as a secondary recovery path.

### Selective cloud update cadence

- Motion, contact, leak, plug, light, and availability changes request an immediate cloud publish.
- Urgent changes are debounced for 200 ms so related attributes produce one current snapshot instead of a burst.
- Temperature, humidity, air-quality, illuminance, and battery-only changes remain on the one-minute cloud cadence.
- The one-minute full-state publish remains as a heartbeat and reconciliation path.
- Each generated state includes a sequence number so the website can distinguish multiple changes within the same second.

### Stale-device handling

- Normal inactivity does not make a device stale. Battery-powered motion, contact, and leak sensors may legitimately remain silent until their value changes.
- A device becomes stale only when its Matter subscription fails or when both reconciliation-read attempts fail without a healthy subscription.
- Any successful report or read clears the stale state immediately.
- A stale device keeps its last known value.
- Its device row is faded to 45% opacity instead of displaying the word `STALE`.

### Contact, motion, and leak history

- CoreS3 keeps the last 50 **open-class** events per contact, motion, and leak sensor in PSRAM.
- A row is appended only for `OPEN`, `DETECTED`, or `LEAK`. `CLOSED`, `CLEAR`, and `DRY` are not stored.
- History is not included in SSE or `/state.json`. Tap a contact, motion, or leak row (or its plan mark) to load `GET /history?id=matter-5`.
- The sheet shows kind, then day groups (`20 Sep 2026`) with a small gap between days. Each row is location, time, and Open / Detected / Leak.
- Close is an X in the sheet header. There are no C / A / O filter chips.
- Each contact, motion, and leak row has 24 tiny 3px hour dots on the existing bottom edge so the row stays the same height as lights and climate. A small gap every 6 hours marks night / morning / afternoon / evening. A local-hour dot turns black only for `OPEN`, `DETECTED`, or `LEAK` in that hour today. `CLOSED`, `CLEAR`, and `DRY` do not fill a square. Many trips at 10:00 still fill only the 10 dot.
- A CoreS3 reboot starts a fresh local list. Temperature, plugs, and lights are not recorded yet.

### Battery levels

- Battery-powered devices show a battery icon and cached percentage beneath the primary value.
- Motion rows place illuminance first and battery on the same secondary line.
- The icon fill reflects the reported battery percentage.
- Standalone battery readings use a wider icon-to-number gap; the compact motion layout is unchanged.
- The page reuses `batteryPercent` from the existing state readings and does not make additional Matter requests.
- Battery values below 20% are highlighted in red.
- Battery display therefore adds negligible processing and network overhead.

## Expected timing

| Situation | Expected result |
| --- | --- |
| Normal device change | Instant through SSE |
| Browser wakes or regains focus | Immediate snapshot refresh |
| Silent/broken SSE connection | Detected within about 10 seconds |
| SSE unavailable | State updates within about 2 seconds through polling |
| Matter subscription failure | Retries with bounded exponential backoff |
| Third local page | Uses 2-second polling |

## How to test

Refresh every open local page once after installing new firmware so it loads the latest embedded JavaScript.

### 1. Instant motion updates

1. Open the CoreS3 local page.
2. Wait until the motion sensor shows `CLEAR`.
3. Walk past the sensor.
4. Confirm it changes to `DETECTED` without refreshing the page.

Expected: the change appears immediately.

### 2. Idle-page recovery

1. Leave the local page open and unused for an extended period.
2. Trigger motion.
3. Do not move the mouse and do not refresh.

Expected: the value changes automatically.

### 3. Sleep and wake

1. Leave the local page open.
2. Put the laptop to sleep.
3. Wake it after several minutes.
4. Trigger motion or change another device.

Expected: the page refreshes its snapshot immediately after waking and continues receiving live updates.

### 4. Two simultaneous clients

1. Open the local page on a laptop.
2. Open it on a phone or second browser.
3. Trigger motion or change a contact sensor.

Expected: both pages update immediately.

### 5. Third client fallback

1. Keep two local pages open.
2. Open a third page.
3. Trigger a device change.

Expected: the first two pages update immediately. The third updates within about 2 seconds and does not disconnect the first two.

### 6. Polling recovery

1. Leave the page open.
2. Temporarily interrupt the browser's network connection.
3. Restore the connection.

Expected: the page shows a reconnecting state, uses polling while SSE is unavailable, then returns to SSE automatically.

### 7. No false stale state

1. Leave motion, contact, and leak sensors unchanged for more than two minutes.
2. Inspect their rows.

Expected: rows remain normal. Silence alone must not mark them stale.

### 8. Real stale-device recovery

1. Disconnect or power down a Matter device long enough for its subscription or reconciliation reads to fail.
2. Observe its row.
3. Restore the device.

Expected: the row fades gray after a confirmed communication failure and returns to normal after a successful report or read.

### 9. Battery display

1. Open the local page after refreshing it once.
2. Find a battery-powered motion, contact, leak, or climate sensor.
3. Compare the displayed percentage with `batteryPercent` in `/state.json`.

Expected: the row shows a proportionally filled battery icon with `N%` without causing extra Matter reads. Motion displays `N lx` followed by the compact battery reading on the same line. Values below 20% use the low-battery highlight.

### 10. Contact / motion / leak history

1. Refresh the local page once after the new firmware.
2. Tap **Contact**, **Motion**, or **Leak**.
3. Confirm the sheet title is the kind, there is no C / A / O row, Close is an X, and events are grouped under a date (`20 Sep 2026`) with a small gap between days. Each row is location, time, and Open / Detected / Leak.
4. Open the door, walk past the PIR, or trip the leak sensor without refreshing.

Expected: a new Open / Detected / Leak row appears under today. Closed / clear / dry flips do not add a row. The live page stays instant.

## Physical light-switch limitation

Turning off a traditional wall switch removes power from a smart bulb. The bulb cannot receive Matter commands until it boots and rejoins the Thread network after power is restored. Browser and CoreS3 reliability logic cannot eliminate that hardware recovery time.

For consistently available smart lighting, use a switch arrangement that keeps permanent power at the bulb or install a compatible smart switch.

## Troubleshooting

- If values do not update, refresh the local page once to load the current embedded client.
- If only a third page updates slowly, that is the expected polling fallback.
- If a battery sensor becomes gray merely from inactivity, the stale logic has regressed; silence alone must not mark it stale.
- If a physically power-cycled bulb ignores an immediate command, wait for it to rejoin Thread and try again.
- If history is empty, refresh the local page after OTA and wait for the first Matter report, then open a door or walk past the PIR.
- Confirm the active firmware label through the gateway state before diagnosing behavior from an older image.

# Matter fabric notes

Do not store setup codes, Thread dataset TLVs, or Wi-Fi passwords here.

The live HomeHub list is `fabricDevices` in [packages/catalog/homehub.json](../../packages/catalog/homehub.json). TypeScript (`cores3-fabric.ts`) and Python (`cores3_fabric.py`) both read it. That list is the source of truth for device ids. This file is only a reminder of how to pick the **next Thread node id**.

## Next node id

1. Ask the CoreS3 controller which nodes already exist (`matter esp controller list` or the current pairing logs).
2. Do not reuse a live node id.
3. Pairing from the website also assigns the next unused node.

After a successful pair, add the device to `fabricDevices` in the catalog if it should appear in HomeHub. Do not commit pairing secrets.

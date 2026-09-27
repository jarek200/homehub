# Matter fabric notes

Do not store setup codes, Thread dataset TLVs, or Wi-Fi passwords here.

The live HomeHub catalog is in `packages/core/src/cores3-fabric.ts` (and the matching Python module). That list is the source of truth for device ids. This file is only a reminder of how to pick the **next Thread node id**.

## Next node id

1. Ask the CoreS3 controller which nodes already exist (`matter esp controller list` or the current pairing logs).
2. Do not reuse a live node id.
3. Pairing from the website also assigns the next unused node.

After a successful pair, register the device in `cores3-fabric.ts` if it should appear in HomeHub. Do not commit pairing secrets.

/** CoreS3 Matter fabric as registered in HomeHub. Data lives in @homehub/catalog. */

import catalog from '@homehub/catalog/homehub.json';

export const CORES3_GATEWAY_ID = catalog.gatewayId;

export const CORES3_FABRIC_DEVICES = catalog.fabricDevices as ReadonlyArray<{
  deviceId: string;
  name: string;
  type: string;
  location: string;
  runtimeKind: 'physical' | 'matter';
  nodeId: number | null;
  endpoint: number | null;
  clusters: string[] | null;
}>;

const LEGACY_DUMMY_IDS = new Set(catalog.legacyDummyIds);

function collectIds(state: {
  lock?: { id?: string } | null;
  lights?: { id?: string }[];
  plugs?: { id?: string }[];
  contacts?: { id?: string }[];
  motions?: { id?: string }[];
  leaks?: { id?: string }[];
  buttons?: { id?: string }[];
}): string[] {
  const ids = [
    state.lock?.id,
    ...(state.lights ?? []).map((item) => item.id),
    ...(state.plugs ?? []).map((item) => item.id),
    ...(state.contacts ?? []).map((item) => item.id),
    ...(state.motions ?? []).map((item) => item.id),
    ...(state.leaks ?? []).map((item) => item.id),
    ...(state.buttons ?? []).map((item) => item.id),
  ];
  return ids.filter((id): id is string => Boolean(id));
}

export function isLegacyDummyHouseholdState(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false;
  return collectIds(state as Parameters<typeof collectIds>[0]).some((id) =>
    LEGACY_DUMMY_IDS.has(id)
  );
}

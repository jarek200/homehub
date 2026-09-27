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

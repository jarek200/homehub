/** Known IKEA Matter products that HomeHub can add from the website. */

import catalog from '@homehub/catalog/homehub.json';

export const CORES3_RESERVED_NODE_IDS = catalog.reservedNodeIds;

export const CORES3_HOUSEHOLD_KINDS = catalog.householdKinds;

export type Cores3HouseholdKind = (typeof CORES3_HOUSEHOLD_KINDS)[number];

export interface Cores3Product {
  productId: string;
  name: string;
  label: string;
  type: string;
  household: Cores3HouseholdKind;
  endpoint: number;
  clusters: string[];
  clusterEndpoints?: Record<string, number>;
}

export const CORES3_PRODUCTS: Cores3Product[] = catalog.products.map((product) => {
  const endpoints = product.clusterEndpoints;
  const clusterEndpoints = endpoints
    ? Object.fromEntries(
        Object.entries(endpoints).filter((entry): entry is [string, number] => {
          return typeof entry[1] === 'number';
        })
      )
    : undefined;
  return {
    productId: product.productId,
    name: product.name,
    label: product.label,
    type: product.type,
    household: product.household,
    endpoint: product.endpoint,
    clusters: product.clusters,
    clusterEndpoints,
  };
});

export function cores3ProductById(productId: string): Cores3Product | undefined {
  return CORES3_PRODUCTS.find((product) => product.productId === productId);
}

export function nextProductName(base: string, existingNames: string[]): string {
  const names = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let index = 2;
  while (names.has(`${base} ${index}`.toLowerCase())) {
    index += 1;
  }
  return `${base} ${index}`;
}

export function matterDeviceNumber(deviceId: string): number | null {
  const match = /^matter-(\d+)$/.exec(deviceId);
  if (!match) return null;
  return Number(match[1]);
}

export function nextMatterDeviceId(existingIds: string[]): string {
  let max = 0;
  for (const id of existingIds) {
    const number = matterDeviceNumber(id);
    if (number != null && number > max) max = number;
  }
  return `matter-${max + 1}`;
}

export function nextMatterNodeId(existingNodeIds: Array<number | null | undefined>): number {
  const used = new Set<number>(CORES3_RESERVED_NODE_IDS);
  for (const nodeId of existingNodeIds) {
    if (typeof nodeId === 'number' && nodeId >= 1) used.add(nodeId);
  }
  let next = 1;
  while (used.has(next)) next += 1;
  return next;
}

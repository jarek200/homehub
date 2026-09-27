import {
  createEmptyFloorPlan,
  createPlanForName,
  createPlanItemId,
  type FloorPlan,
  floorPlanUpdatedAt,
  isLegacySideBySideLayout,
  parseFloorPlan,
  pickNewerFloorPlan,
  planDeviceRoomLocation,
  planRoomAt,
} from './floor-plan';

export const DEFAULT_HOME_PLAN_NAME = 'Home';

export interface FloorPlanLibrary {
  activePlanId: string;
  plans: FloorPlan[];
  updatedAt?: string;
}

export function createNamedFloorPlan(name: string): FloorPlan {
  const trimmed = name.trim() || DEFAULT_HOME_PLAN_NAME;
  return {
    ...createPlanForName(trimmed),
    id: createPlanItemId('plan'),
    name: trimmed,
  };
}

export function emptyFloorPlanLibrary(): FloorPlanLibrary {
  const plan = { ...createEmptyFloorPlan(DEFAULT_HOME_PLAN_NAME), id: 'user-plan' };
  return { activePlanId: plan.id, plans: [plan] };
}

/** Wrap a pre-library singleton. Keep the stored name; default only if blank. */
export function libraryFromLegacyPlan(plan: FloorPlan): FloorPlanLibrary {
  const named = { ...plan, name: plan.name.trim() || DEFAULT_HOME_PLAN_NAME };
  return { activePlanId: named.id, plans: [named] };
}

export function stampFloorPlanLibrary(
  library: FloorPlanLibrary,
  at = new Date().toISOString()
): FloorPlanLibrary {
  return { ...library, updatedAt: at };
}

export function libraryActivePlan(library: FloorPlanLibrary): FloorPlan {
  return (
    library.plans.find((plan) => plan.id === library.activePlanId) ??
    library.plans[0] ??
    createEmptyFloorPlan(DEFAULT_HOME_PLAN_NAME)
  );
}

export function libraryHasContent(library: FloorPlanLibrary): boolean {
  return library.plans.length > 1 || library.plans.some((plan) => plan.rooms.length > 0);
}

export function parseFloorPlanLibrary(value: unknown): FloorPlanLibrary | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { activePlanId?: unknown; plans?: unknown; updatedAt?: unknown };
  if (!Array.isArray(raw.plans) || raw.plans.length === 0) return null;

  const plans = raw.plans
    .map((item) => parseFloorPlan(item))
    .filter((plan): plan is FloorPlan => plan != null);
  const first = plans[0];
  if (!first) return null;

  const activePlanId =
    typeof raw.activePlanId === 'string' && plans.some((plan) => plan.id === raw.activePlanId)
      ? raw.activePlanId
      : first.id;

  return collapseDuplicatePlanNames({
    activePlanId,
    plans,
    updatedAt:
      typeof raw.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))
        ? raw.updatedAt
        : undefined,
  });
}

export function upsertLibraryPlan(library: FloorPlanLibrary, plan: FloorPlan): FloorPlanLibrary {
  const index = library.plans.findIndex((item) => item.id === plan.id);
  if (index >= 0 && library.plans[index] === plan && library.activePlanId === plan.id) {
    return library;
  }

  const plans = [...library.plans];
  if (index >= 0) plans[index] = plan;
  else plans.push(plan);

  return {
    ...library,
    activePlanId: plan.id,
    plans,
  };
}

export function addNamedPlan(library: FloorPlanLibrary, name: string): FloorPlanLibrary {
  const trimmed = name.trim();
  if (!trimmed) return library;
  const plan = createNamedFloorPlan(trimmed);
  return stampFloorPlanLibrary({
    activePlanId: plan.id,
    plans: [...library.plans, plan],
  });
}

export function switchActivePlan(library: FloorPlanLibrary, planId: string): FloorPlanLibrary {
  if (library.activePlanId === planId) return library;
  if (!library.plans.some((plan) => plan.id === planId)) return library;
  return stampFloorPlanLibrary({ ...library, activePlanId: planId });
}

function preferRicherPlan(left: FloorPlan, right: FloorPlan): FloorPlan {
  const leftLegacy = isLegacySideBySideLayout(left);
  const rightLegacy = isLegacySideBySideLayout(right);
  if (leftLegacy !== rightLegacy) return leftLegacy ? right : left;
  if (left.sensors.length !== right.sensors.length) {
    return left.sensors.length > right.sensors.length ? left : right;
  }
  if (left.rooms.length !== right.rooms.length) {
    return left.rooms.length > right.rooms.length ? left : right;
  }
  return pickNewerFloorPlan(left, right) ?? left;
}

/** Drop leftover singleton copies that share a name after the first migration. */
export function collapseDuplicatePlanNames(library: FloorPlanLibrary): FloorPlanLibrary {
  const kept: FloorPlan[] = [];
  for (const plan of library.plans) {
    const index = kept.findIndex(
      (item) => item.name.trim().toLowerCase() === plan.name.trim().toLowerCase()
    );
    if (index < 0) {
      kept.push(plan);
      continue;
    }
    const current = kept[index];
    if (current) kept[index] = preferRicherPlan(current, plan);
  }

  if (kept.length === library.plans.length) return library;

  const ids = new Set(kept.map((plan) => plan.id));
  const fallback = kept[0];
  return stampFloorPlanLibrary({
    ...library,
    plans: kept,
    activePlanId: ids.has(library.activePlanId)
      ? library.activePlanId
      : (fallback?.id ?? library.activePlanId),
  });
}

export function mergeFloorPlanLibraries(
  local: FloorPlanLibrary,
  remote: FloorPlanLibrary | null
): FloorPlanLibrary {
  if (!remote) return collapseDuplicatePlanNames(local);
  if (!libraryHasContent(local) && libraryHasContent(remote)) {
    return collapseDuplicatePlanNames(remote);
  }
  if (!libraryHasContent(remote)) return collapseDuplicatePlanNames(local);

  const localPlan = local.plans[0];
  const remotePlan = remote.plans[0];
  if (local.plans.length === 1 && remote.plans.length === 1 && localPlan && remotePlan) {
    if (localPlan.id !== remotePlan.id) {
      const winner = preferRicherPlan(localPlan, remotePlan);
      return stampFloorPlanLibrary({ activePlanId: winner.id, plans: [winner] });
    }
  }

  const byId = new Map<string, FloorPlan>();
  for (const plan of remote.plans) byId.set(plan.id, plan);
  for (const plan of local.plans) {
    const existing = byId.get(plan.id);
    if (!existing || floorPlanUpdatedAt(plan) >= floorPlanUpdatedAt(existing)) {
      byId.set(plan.id, plan);
    }
  }

  const plans = [...byId.values()];
  const fallback = plans[0];
  if (!fallback) return collapseDuplicatePlanNames(local);
  const activePlanId = byId.has(local.activePlanId)
    ? local.activePlanId
    : byId.has(remote.activePlanId)
      ? remote.activePlanId
      : fallback.id;

  return collapseDuplicatePlanNames(stampFloorPlanLibrary({ activePlanId, plans }));
}

export function deviceIdsOnPlan(plan: FloorPlan): Set<string> {
  const ids = new Set<string>();
  for (const sensor of plan.sensors) {
    if (sensor.deviceId) ids.add(sensor.deviceId);
  }
  return ids;
}

export function deviceIdsInLibrary(
  library: FloorPlanLibrary,
  planId: string | 'all'
): Set<string> | null {
  if (planId === 'all') return null;
  const plan = library.plans.find((item) => item.id === planId);
  return plan ? deviceIdsOnPlan(plan) : new Set();
}

function plansForDeviceLocation(
  library: FloorPlanLibrary,
  planId: string | 'all' = 'all'
): FloorPlan[] {
  if (planId !== 'all') {
    const plan = library.plans.find((item) => item.id === planId);
    return plan ? [plan] : [];
  }
  const active = libraryActivePlan(library);
  return [active, ...library.plans.filter((plan) => plan.id !== active.id)];
}

export function libraryDeviceLocation(
  library: FloorPlanLibrary,
  deviceId: string,
  planId: string | 'all' = 'all'
): string {
  for (const plan of plansForDeviceLocation(library, planId)) {
    const sensor = plan.sensors.find((item) => item.deviceId === deviceId);
    if (!sensor) continue;
    const room = planRoomAt(plan, sensor.x, sensor.y);
    return planDeviceRoomLocation(room?.name, sensor.x, sensor.y);
  }
  return '';
}

export function deviceListLocation(
  library: FloorPlanLibrary | null | undefined,
  device: { deviceId: string; location?: string | null },
  planId: string | 'all' = 'all'
): string {
  const fromPlan = library ? libraryDeviceLocation(library, device.deviceId, planId) : '';
  return fromPlan || device.location?.trim() || '';
}

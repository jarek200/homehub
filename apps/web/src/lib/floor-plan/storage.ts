import {
  DEFAULT_DOOR_LENGTH,
  emptyFloorPlanLibrary,
  type FloorPlan,
  type FloorPlanLibrary,
  libraryActivePlan,
  libraryFromLegacyPlan,
  mergeFloorPlanLibraries,
  parseFloorPlan,
  parseFloorPlanLibrary,
  rebuildPlanWalls,
  stampFloorPlan,
  stampFloorPlanLibrary,
  upsertLibraryPlan,
} from '@homehub/core';
import { getHouseholdPlanDocument, putHouseholdPlan } from '$lib/services/rest-api';

const STORAGE_KEY = 'homehub.floor-plan.v1';
const LIBRARY_KEY = 'homehub.floor-plan-library.v1';

function persistLocalFloorPlan(plan: FloorPlan): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
}

function persistLocalLibrary(library: FloorPlanLibrary): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  persistLocalFloorPlan(libraryActivePlan(library));
}

function normalizeStoredPlan(plan: FloorPlan): FloorPlan {
  const doors = plan.doors.map((door) =>
    door.length > DEFAULT_DOOR_LENGTH ? { ...door, length: DEFAULT_DOOR_LENGTH } : door
  );
  return rebuildPlanWalls({ ...plan, doors });
}

export function loadStoredFloorPlan(): FloorPlan | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseFloorPlan(JSON.parse(raw));
    return parsed;
  } catch {
    return null;
  }
}

export function loadStoredFloorPlanLibrary(): FloorPlanLibrary | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { plans?: unknown };
      const parsed = parseFloorPlanLibrary(data);
      if (parsed) {
        return {
          ...parsed,
          plans: parsed.plans.map(normalizeStoredPlan),
        };
      }
    }
    const legacy = loadStoredFloorPlan();
    return legacy ? libraryFromLegacyPlan(normalizeStoredPlan(legacy)) : null;
  } catch {
    return null;
  }
}

export function saveStoredFloorPlan(plan: FloorPlan): void {
  const next = stampFloorPlan(plan);
  const stored = loadStoredFloorPlanLibrary();
  const library = stampFloorPlanLibrary(
    upsertLibraryPlan(stored ?? libraryFromLegacyPlan(next), next)
  );
  persistLocalLibrary(library);
  void putHouseholdPlan(next, library).catch(() => {
    // Editor keeps the stamped local copy; the next hub sync republishes it.
  });
}

export function saveStoredFloorPlanLibrary(library: FloorPlanLibrary): void {
  const next = stampFloorPlanLibrary(library);
  persistLocalLibrary(next);
  void putHouseholdPlan(libraryActivePlan(next), next).catch(() => {
    // Editor keeps the stamped local copy; the next hub sync republishes it.
  });
}

export function initialEditorLibrary(): FloorPlanLibrary {
  return loadStoredFloorPlanLibrary() ?? emptyFloorPlanLibrary();
}

export async function syncEditorLibrary(local: FloorPlanLibrary): Promise<FloorPlanLibrary> {
  let remotePlan: FloorPlan | null = null;
  let remoteLibrary: FloorPlanLibrary | null = null;
  try {
    const document = await getHouseholdPlanDocument();
    remotePlan = document.plan;
    remoteLibrary = document.library;
  } catch {
    remotePlan = null;
    remoteLibrary = null;
  }

  const remote = remoteLibrary ?? (remotePlan ? libraryFromLegacyPlan(remotePlan) : null);
  const winner = mergeFloorPlanLibraries(local, remote);
  persistLocalLibrary(winner);
  return winner;
}

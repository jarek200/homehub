import {
  DEFAULT_DOOR_LENGTH,
  emptyFloorPlanLibrary,
  type FloorPlan,
  type FloorPlanLibrary,
  libraryActivePlan,
  libraryFromPlan,
  mergeFloorPlanLibraries,
  parseFloorPlanLibrary,
  rebuildPlanWalls,
  stampFloorPlan,
  stampFloorPlanLibrary,
  upsertLibraryPlan,
} from '@homehub/core';
import { getHouseholdPlanDocument, putHouseholdPlan } from '$lib/services/rest-api';

const LIBRARY_KEY = 'homehub.floor-plan-library.v1';

function persistLocalLibrary(library: FloorPlanLibrary): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
}

function normalizeStoredPlan(plan: FloorPlan): FloorPlan {
  const doors = plan.doors.map((door) =>
    door.length > DEFAULT_DOOR_LENGTH ? { ...door, length: DEFAULT_DOOR_LENGTH } : door
  );
  return rebuildPlanWalls({ ...plan, doors });
}

function loadStoredFloorPlanLibrary(): FloorPlanLibrary | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { plans?: unknown };
    const parsed = parseFloorPlanLibrary(data);
    if (!parsed) return null;
    return {
      ...parsed,
      plans: parsed.plans.map(normalizeStoredPlan),
    };
  } catch {
    return null;
  }
}

export function saveStoredFloorPlan(plan: FloorPlan): void {
  const next = stampFloorPlan(plan);
  const stored = loadStoredFloorPlanLibrary();
  const library = stampFloorPlanLibrary(upsertLibraryPlan(stored ?? libraryFromPlan(next), next));
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

  const remote = remoteLibrary ?? (remotePlan ? libraryFromPlan(remotePlan) : null);
  const winner = mergeFloorPlanLibraries(local, remote);
  persistLocalLibrary(winner);
  return winner;
}

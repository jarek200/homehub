/// <reference path="../.sst/platform/config.d.ts" />

/** Repo path to the homehub_api package root inside the Lambda zip. */
export const PYTHON_API_SRC = 'services/api/src';

/**
 * PYTHONPATH so `import homehub_api` works when the handler path is under
 * services/api/src/homehub_api/... (SST bundles from repo root).
 */
export const pythonLambdaEnv = {
  PYTHONPATH: `/var/task/${PYTHON_API_SRC}`,
} as const;

/**
 * The Python bundle only contains the handler tree under services/.
 * catalog_data.py still reads packages/catalog/homehub.json from the zip root.
 */
export const pythonCatalogCopy = [{ from: 'packages/catalog/homehub.json' }];

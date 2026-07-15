/// <reference path="../.sst/platform/config.d.ts" />

/** Repo path to the homehub_api package root inside the Lambda zip. */
export const PYTHON_API_SRC = 'packages/rest-api/src';

/**
 * PYTHONPATH so `import homehub_api` works when the handler path is under
 * packages/rest-api/src/homehub_api/... (SST bundles from repo root).
 */
export const pythonLambdaEnv = {
  PYTHONPATH: `/var/task/${PYTHON_API_SRC}`,
} as const;

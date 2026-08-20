import { parseAdapterMode } from "../config.js";
import type { Directory } from "../types.js";
import { createCapterraFixtureAdapter } from "./capterra/fixture.js";
import { createG2FixtureAdapter } from "./g2/fixture.js";
import { createCapterraLiveAdapter, createG2LiveAdapter } from "./live.js";
import type { DirectoryAdapter } from "./types.js";

export type {
  AdapterErr,
  AdapterFailureCode,
  AdapterProductRequest,
  AdapterProductResult,
  AdapterReviewsRequest,
  AdapterReviewsResult,
  DirectoryAdapter,
} from "./types.js";
export { createCapterraFixtureAdapter } from "./capterra/fixture.js";
export { createG2FixtureAdapter } from "./g2/fixture.js";
export { createCapterraLiveAdapter, createG2LiveAdapter } from "./live.js";

export type AdapterLookup = {
  forDirectory(directory: Directory): DirectoryAdapter | undefined;
};

export function registryOf(...adapters: DirectoryAdapter[]): AdapterLookup {
  const map = new Map<Directory, DirectoryAdapter>();
  for (const adapter of adapters) {
    map.set(adapter.directory, adapter);
  }
  return {
    forDirectory(directory) {
      return map.get(directory);
    },
  };
}

/**
 * Default registry is fixtures. Live G2 / Capterra only when
 * SAASREVIEWS_LIVE_DIRECTORIES=1 and SAASREVIEWS_FIXTURE_ONLY is unset.
 */
export function createAppAdapters(
  env: NodeJS.ProcessEnv = process.env,
): AdapterLookup {
  if (parseAdapterMode(env) === "live") {
    return registryOf(createG2LiveAdapter(), createCapterraLiveAdapter());
  }
  return registryOf(createG2FixtureAdapter(), createCapterraFixtureAdapter());
}

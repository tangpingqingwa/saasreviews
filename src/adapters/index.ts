import { createCapterraFixtureAdapter } from "./capterra/fixture.js";
import { createG2FixtureAdapter } from "./g2/fixture.js";
import type { Directory } from "../types.js";
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

/** Fixture adapters for every v1 directory. Live G2 / Capterra stay out. */
export function createAppAdapters(): AdapterLookup {
  return registryOf(createG2FixtureAdapter(), createCapterraFixtureAdapter());
}

import { createG2FixtureAdapter } from "./g2/fixture.js";
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
export { createG2FixtureAdapter } from "./g2/fixture.js";

/** PR 2 wires the G2 fixture adapter only. Live G2 / Capterra are later PRs. */
export function createAppAdapter(): DirectoryAdapter {
  return createG2FixtureAdapter();
}

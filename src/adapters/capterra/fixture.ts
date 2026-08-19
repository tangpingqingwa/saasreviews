import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonFixtureAdapter } from "../fixture.js";
import type { DirectoryAdapter } from "../types.js";

export const DEFAULT_CAPTERRA_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/capterra",
);

/** Public Capterra stars are out of 5 in v1 unless a fixture says otherwise. */
export const CAPTERRA_STAR_MAX = 5;

export type CapterraFixtureAdapterOptions = {
  dir?: string;
};

export function createCapterraFixtureAdapter(
  options: CapterraFixtureAdapterOptions = {},
): DirectoryAdapter {
  return createJsonFixtureAdapter({
    directory: "capterra",
    dir: options.dir ?? DEFAULT_CAPTERRA_FIXTURE_DIR,
    starMax: CAPTERRA_STAR_MAX,
  });
}

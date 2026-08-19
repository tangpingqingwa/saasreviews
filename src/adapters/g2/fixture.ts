import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonFixtureAdapter } from "../fixture.js";
import type { DirectoryAdapter } from "../types.js";

export const DEFAULT_G2_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/g2",
);

export const G2_STAR_MAX = 5;

export type G2FixtureAdapterOptions = {
  dir?: string;
};

export function createG2FixtureAdapter(
  options: G2FixtureAdapterOptions = {},
): DirectoryAdapter {
  return createJsonFixtureAdapter({
    directory: "g2",
    dir: options.dir ?? DEFAULT_G2_FIXTURE_DIR,
    starMax: G2_STAR_MAX,
  });
}

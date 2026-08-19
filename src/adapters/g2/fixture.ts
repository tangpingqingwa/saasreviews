import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  productCardSchema,
  reviewPageSchema,
  type ProductCard,
  type ReviewPage,
} from "../../types.js";
import type {
  AdapterProductResult,
  AdapterReviewsResult,
  DirectoryAdapter,
} from "../types.js";

export const DEFAULT_G2_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/g2",
);

export const G2_STAR_MAX = 5;

export type G2FixtureAdapterOptions = {
  dir?: string;
};

type ProductIndex = Map<string, ProductCard>;
type ReviewIndex = Map<string, Map<number, ReviewPage>>;

export function createG2FixtureAdapter(
  options: G2FixtureAdapterOptions = {},
): DirectoryAdapter {
  const dir = options.dir ?? DEFAULT_G2_FIXTURE_DIR;
  const products = loadProductFixtures(dir);
  const reviews = loadReviewFixtures(dir);
  return {
    directory: "g2",
    async fetchProduct(request): Promise<AdapterProductResult> {
      const card = products.get(request.directorySlug);
      if (card === undefined) {
        return { ok: false, code: "product_not_found" };
      }
      return { ok: true, card: cloneCard(card) };
    },
    async fetchReviews(request): Promise<AdapterReviewsResult> {
      if (!products.has(request.directorySlug)) {
        return { ok: false, code: "product_not_found" };
      }
      const page = reviews.get(request.directorySlug)?.get(request.page);
      if (page === undefined) {
        return {
          ok: true,
          page: { page: request.page, hasMore: false, reviews: [] },
        };
      }
      return { ok: true, page: cloneReviewPage(page) };
    },
  };
}

export function loadProductFixtures(dir: string): ProductIndex {
  const productsDir = join(dir, "products");
  const index: ProductIndex = new Map();
  for (const file of listJson(productsDir)) {
    const raw: unknown = JSON.parse(readFileSync(join(productsDir, file), "utf8"));
    const parsed = productCardSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`invalid G2 product fixture ${file}: ${parsed.error.message}`);
    }
    const card = parsed.data;
    if (card.product.directory !== "g2") {
      throw new Error(`G2 fixture ${file} must use directory g2`);
    }
    if (card.scores.max !== G2_STAR_MAX) {
      throw new Error(`G2 fixture ${file} must set scores.max to ${G2_STAR_MAX}`);
    }
    if (index.has(card.product.directorySlug)) {
      throw new Error(`duplicate G2 product fixture for ${card.product.directorySlug}`);
    }
    index.set(card.product.directorySlug, card);
  }
  return index;
}

export function loadReviewFixtures(dir: string): ReviewIndex {
  const reviewsDir = join(dir, "reviews");
  const index: ReviewIndex = new Map();
  for (const file of listJson(reviewsDir)) {
    const raw: unknown = JSON.parse(readFileSync(join(reviewsDir, file), "utf8"));
    const parsed = reviewPageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`invalid G2 review fixture ${file}: ${parsed.error.message}`);
    }
    const slug = file.replace(/-page-\d+\.json$/, "");
    const page = parsed.data;
    const pages = index.get(slug) ?? new Map<number, ReviewPage>();
    if (pages.has(page.page)) {
      throw new Error(`duplicate G2 review fixture for ${slug} page ${page.page}`);
    }
    pages.set(page.page, page);
    index.set(slug, pages);
  }
  return index;
}

function listJson(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function cloneCard(card: ProductCard): ProductCard {
  return structuredClone(card);
}

function cloneReviewPage(page: ReviewPage): ReviewPage {
  return structuredClone(page);
}

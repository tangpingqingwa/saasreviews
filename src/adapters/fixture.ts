import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  productCardSchema,
  reviewPageSchema,
  type Directory,
  type ProductCard,
  type ReviewPage,
} from "../types.js";
import type {
  AdapterProductResult,
  AdapterReviewsResult,
  DirectoryAdapter,
} from "./types.js";

type ProductIndex = Map<string, ProductCard>;
type ReviewIndex = Map<string, Map<number, ReviewPage>>;

export type JsonFixtureAdapterOptions = {
  directory: Directory;
  dir: string;
  starMax: number;
};

export function createJsonFixtureAdapter(
  options: JsonFixtureAdapterOptions,
): DirectoryAdapter {
  const products = loadProductFixtures(options);
  const reviews = loadReviewFixtures(options);
  return {
    directory: options.directory,
    async fetchProduct(request): Promise<AdapterProductResult> {
      if (request.directory !== options.directory) {
        return { ok: false, code: "directory_unsupported" };
      }
      const card = products.get(request.directorySlug);
      if (card === undefined) {
        return { ok: false, code: "product_not_found" };
      }
      return { ok: true, card: structuredClone(card) };
    },
    async fetchReviews(request): Promise<AdapterReviewsResult> {
      if (request.directory !== options.directory) {
        return { ok: false, code: "directory_unsupported" };
      }
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
      return { ok: true, page: structuredClone(page) };
    },
    listProducts(): ProductCard[] {
      return [...products.values()].map((card) => structuredClone(card));
    },
  };
}

export function loadProductFixtures(
  options: JsonFixtureAdapterOptions,
): ProductIndex {
  const productsDir = join(options.dir, "products");
  const index: ProductIndex = new Map();
  for (const file of listJson(productsDir)) {
    const raw: unknown = JSON.parse(readFileSync(join(productsDir, file), "utf8"));
    const parsed = productCardSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `invalid ${options.directory} product fixture ${file}: ${parsed.error.message}`,
      );
    }
    const card = parsed.data;
    if (card.product.directory !== options.directory) {
      throw new Error(
        `${options.directory} fixture ${file} must use directory ${options.directory}`,
      );
    }
    if (card.scores.max !== options.starMax) {
      throw new Error(
        `${options.directory} fixture ${file} must set scores.max to ${options.starMax}`,
      );
    }
    if (index.has(card.product.directorySlug)) {
      throw new Error(
        `duplicate ${options.directory} product fixture for ${card.product.directorySlug}`,
      );
    }
    index.set(card.product.directorySlug, card);
  }
  return index;
}

export function loadReviewFixtures(
  options: Pick<JsonFixtureAdapterOptions, "directory" | "dir">,
): ReviewIndex {
  const reviewsDir = join(options.dir, "reviews");
  const index: ReviewIndex = new Map();
  for (const file of listJson(reviewsDir)) {
    const raw: unknown = JSON.parse(readFileSync(join(reviewsDir, file), "utf8"));
    const parsed = reviewPageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `invalid ${options.directory} review fixture ${file}: ${parsed.error.message}`,
      );
    }
    const slug = file.replace(/-page-\d+\.json$/, "");
    const page = parsed.data;
    const pages = index.get(slug) ?? new Map<number, ReviewPage>();
    if (pages.has(page.page)) {
      throw new Error(
        `duplicate ${options.directory} review fixture for ${slug} page ${page.page}`,
      );
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

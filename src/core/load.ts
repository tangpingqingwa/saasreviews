import type { DirectoryAdapter } from "../adapters/index.js";
import {
  getCacheEntry,
  productCacheKey,
  setCacheTombstone,
  setProductCache,
} from "../cache/store.js";
import type { SaasReviewsDb } from "../db.js";
import {
  productCardSchema,
  type Directory,
  type ErrorCode,
  type ProductCard,
} from "../types.js";
import { productIdFor } from "./url.js";

export type LoadProductOk = {
  ok: true;
  card: ProductCard;
  cached: boolean;
  upstreamMs: number;
};

export type LoadProductErr = {
  ok: false;
  code: Extract<
    ErrorCode,
    "product_not_found" | "directory_unsupported" | "upstream_blocked" | "internal"
  >;
};

export type LoadProductResult = LoadProductOk | LoadProductErr;

export async function loadProductCard(input: {
  db: SaasReviewsDb;
  adapter: DirectoryAdapter;
  directory: Directory;
  directorySlug: string;
  url: string;
}): Promise<LoadProductResult> {
  const cacheKey = productCacheKey(input.directory, input.directorySlug);
  const cached = getCacheEntry(input.db, cacheKey);
  if (cached.hit && cached.kind === "product") {
    const data = readCachedCard(cached.body);
    if (data !== null) {
      return { ok: true, card: data, cached: true, upstreamMs: 0 };
    }
  }
  if (cached.hit && cached.kind === "tombstone") {
    return { ok: false, code: cached.errorCode };
  }

  const started = performance.now();
  let adapterResult;
  try {
    adapterResult = await input.adapter.fetchProduct({
      directory: input.directory,
      directorySlug: input.directorySlug,
      url: input.url,
    });
  } catch {
    return { ok: false, code: "internal" };
  }
  const upstreamMs = Math.max(0, Math.round(performance.now() - started));

  if (!adapterResult.ok) {
    if (adapterResult.code === "product_not_found") {
      setCacheTombstone(input.db, cacheKey, adapterResult.code);
    }
    return { ok: false, code: adapterResult.code };
  }

  const card = normalizeCard(
    adapterResult.card,
    input.adapter,
    input.directorySlug,
    input.url,
  );
  setProductCache(input.db, cacheKey, JSON.stringify(card));
  return { ok: true, card, cached: false, upstreamMs };
}

export function normalizeCard(
  card: ProductCard,
  adapter: DirectoryAdapter,
  slug: string,
  url: string,
): ProductCard {
  return {
    ...card,
    product: {
      ...card.product,
      id: productIdFor(adapter.directory, slug),
      directory: adapter.directory,
      directorySlug: slug,
      url,
    },
    sameAs: [],
    scores: {
      overall: missingOverall(card.scores.overall, card.scores.reviewCount),
      max: statedMax(card.scores.max),
      reviewCount: card.scores.reviewCount,
    },
  };
}

export function listedCards(adapter: DirectoryAdapter): ProductCard[] {
  return adapter.listProducts().map((card) =>
    normalizeCard(
      card,
      adapter,
      card.product.directorySlug,
      card.product.url,
    ),
  );
}

function statedMax(max: number): number {
  if (Number.isFinite(max) && max > 0) {
    return max;
  }
  return 5;
}

function missingOverall(
  overall: number | null,
  reviewCount: number | null,
): number | null {
  if (overall === null) {
    return null;
  }
  if (overall === 0 && (reviewCount === null || reviewCount === 0)) {
    return null;
  }
  return overall;
}

function readCachedCard(body: string): ProductCard | null {
  try {
    const parsed = productCardSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

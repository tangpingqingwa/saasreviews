import { randomUUID } from "node:crypto";
import type { DirectoryAdapter } from "../adapters/types.js";
import { chargeCredits, getCredits, PRODUCT_CREDIT_COST } from "../billing/credits.js";
import type { Key } from "../billing/keys.js";
import {
  getCacheEntry,
  productCacheKey,
  setCacheTombstone,
  setProductCache,
} from "../cache/store.js";
import type { SaasReviewsDb } from "../db.js";
import {
  productCardSchema,
  type Err,
  type ErrorCode,
  type Ok,
  type ProductCard,
} from "../types.js";
import { parseProductUrl } from "./url.js";

export const PRODUCT_BY_URL_ROUTE = "/v1/products/by-url" as const;

export type ProductOutcome = Ok<ProductCard> | Err;

export type GetProductByUrlInput = {
  db: SaasReviewsDb;
  adapter: DirectoryAdapter;
  key: Key;
  url: string | undefined;
  requestId?: string;
};

const ERROR_MESSAGE: Record<ErrorCode, string> = {
  invalid_request: "Provide a url query parameter.",
  unauthorized: "Missing or invalid API key.",
  payment_required: "This key has no credits remaining.",
  product_not_found: "No public product matched that URL.",
  directory_unsupported: "Directory is not g2 or capterra.",
  unmatched_compare: "Compare ran but the products are not linked.",
  rate_limited: "Rate limit exceeded.",
  upstream_blocked: "The directory blocked this request.",
  internal: "Internal error.",
};

export async function getProductByUrl(
  input: GetProductByUrlInput,
): Promise<ProductOutcome> {
  const requestId = input.requestId ?? newRequestId();
  const parsed = parseProductUrl(input.url);
  if (!parsed.ok) {
    return fail(parsed.code, requestId, parsed.message);
  }
  if (parsed.directory !== input.adapter.directory) {
    return fail(
      "directory_unsupported",
      requestId,
      "Only G2 product URLs are supported in this milestone.",
    );
  }

  const remaining = getCredits(input.db, input.key.id);
  if (remaining === null) {
    return fail("unauthorized", requestId);
  }
  if (remaining < PRODUCT_CREDIT_COST) {
    return fail("payment_required", requestId);
  }

  const cacheKey = productCacheKey(parsed.directory, parsed.directorySlug);
  const cached = getCacheEntry(input.db, cacheKey);
  if (cached.hit && cached.kind === "product") {
    const data = readCachedCard(cached.body);
    if (data !== null) {
      return succeed(input, {
        data,
        cached: true,
        requestId,
        upstreamMs: 0,
      });
    }
  }
  if (cached.hit && cached.kind === "tombstone") {
    return fail(cached.errorCode, requestId);
  }

  const started = performance.now();
  let adapterResult;
  try {
    adapterResult = await input.adapter.fetchProduct({
      directory: parsed.directory,
      directorySlug: parsed.directorySlug,
      url: parsed.url,
    });
  } catch {
    return fail("internal", requestId);
  }
  const upstreamMs = Math.max(0, Math.round(performance.now() - started));

  if (!adapterResult.ok) {
    if (adapterResult.code === "product_not_found") {
      setCacheTombstone(input.db, cacheKey, adapterResult.code);
    }
    return fail(adapterResult.code, requestId);
  }

  const card = normalizeCard(adapterResult.card, parsed.directorySlug, parsed.url);
  setProductCache(input.db, cacheKey, JSON.stringify(card));
  return succeed(input, {
    data: card,
    cached: false,
    requestId,
    upstreamMs,
  });
}

function succeed(
  input: GetProductByUrlInput,
  ready: {
    data: ProductCard;
    cached: boolean;
    requestId: string;
    upstreamMs: number;
  },
): Ok<ProductCard> {
  const charge = chargeCredits(input.db, {
    keyId: input.key.id,
    route: PRODUCT_BY_URL_ROUTE,
    credits: PRODUCT_CREDIT_COST,
    cached: ready.cached,
  });
  return {
    data: ready.data,
    meta: {
      cached: ready.cached,
      creditsCharged: charge.ok ? charge.charged : 0,
      requestId: ready.requestId,
      upstreamMs: ready.upstreamMs,
    },
  };
}

function fail(code: ErrorCode, requestId: string, message?: string): Err {
  return {
    error: {
      code,
      message: message ?? ERROR_MESSAGE[code],
      retryable: isRetryableCode(code),
    },
    meta: { creditsCharged: 0, requestId },
  };
}

function normalizeCard(
  card: ProductCard,
  slug: string,
  url: string,
): ProductCard {
  return {
    ...card,
    product: {
      ...card.product,
      directory: "g2",
      directorySlug: slug,
      url,
    },
    sameAs: [],
    scores: {
      overall: missingOverall(card.scores.overall, card.scores.reviewCount),
      max: card.scores.max,
      reviewCount: card.scores.reviewCount,
    },
  };
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

function isRetryableCode(code: ErrorCode): boolean {
  return code === "rate_limited" || code === "upstream_blocked" || code === "internal";
}

function readCachedCard(body: string): ProductCard | null {
  try {
    const parsed = productCardSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function newRequestId(): string {
  return `req_${randomUUID()}`;
}

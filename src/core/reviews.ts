import { randomUUID } from "node:crypto";
import type { DirectoryAdapter } from "../adapters/types.js";
import {
  chargeCredits,
  getCredits,
  REVIEW_PAGE_CREDIT_COST,
} from "../billing/credits.js";
import type { Key } from "../billing/keys.js";
import {
  getCacheEntry,
  reviewsCacheKey,
  setReviewsCache,
} from "../cache/store.js";
import type { SaasReviewsDb } from "../db.js";
import {
  isProductId,
  reviewPageSchema,
  type Err,
  type ErrorCode,
  type Ok,
  type Review,
  type ReviewPage,
} from "../types.js";

export const PRODUCT_REVIEWS_ROUTE = "/v1/products/{id}/reviews" as const;

export type ReviewsOutcome = Ok<ReviewPage> | Err;

export type GetReviewsInput = {
  db: SaasReviewsDb;
  adapter: DirectoryAdapter;
  key: Key;
  productId: string;
  page?: string | number;
  requestId?: string;
};

const ERROR_MESSAGE: Record<ErrorCode, string> = {
  invalid_request: "page must be a positive integer.",
  unauthorized: "Missing or invalid API key.",
  payment_required: "This key has no credits remaining.",
  product_not_found: "No public product matched that id.",
  directory_unsupported: "Directory is not g2 or capterra.",
  unmatched_compare: "Compare ran but the products are not linked.",
  rate_limited: "Rate limit exceeded.",
  upstream_blocked: "The directory blocked this request.",
  internal: "Internal error.",
};

const PRODUCT_ID_PREFIX = "sr_prod_g2_";

export function parseReviewPage(value: string | number | undefined): number | null {
  if (value === undefined || value === "") {
    return 1;
  }
  const page = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(page) || page < 1) {
    return null;
  }
  return page;
}

export function directorySlugFromProductId(productId: string): string | null {
  if (!isProductId(productId) || !productId.startsWith(PRODUCT_ID_PREFIX)) {
    return null;
  }
  const slug = productId.slice(PRODUCT_ID_PREFIX.length);
  return slug.length > 0 ? slug : null;
}

export async function getProductReviews(
  input: GetReviewsInput,
): Promise<ReviewsOutcome> {
  const requestId = input.requestId ?? newRequestId();
  const page = parseReviewPage(input.page);
  if (page === null) {
    return fail("invalid_request", requestId);
  }
  const slug = directorySlugFromProductId(input.productId);
  if (slug === null) {
    return fail("product_not_found", requestId);
  }

  const remaining = getCredits(input.db, input.key.id);
  if (remaining === null) {
    return fail("unauthorized", requestId);
  }
  if (remaining < REVIEW_PAGE_CREDIT_COST) {
    return fail("payment_required", requestId);
  }

  const cacheKey = reviewsCacheKey(input.adapter.directory, slug, page);
  const cached = getCacheEntry(input.db, cacheKey);
  if (cached.hit && cached.kind === "reviews") {
    const data = readCachedPage(cached.body);
    if (data !== null) {
      return succeed(input, {
        data,
        cached: true,
        requestId,
        upstreamMs: 0,
      });
    }
  }

  const started = performance.now();
  let adapterResult;
  try {
    adapterResult = await input.adapter.fetchReviews({
      directory: input.adapter.directory,
      directorySlug: slug,
      page,
    });
  } catch {
    return fail("internal", requestId);
  }
  const upstreamMs = Math.max(0, Math.round(performance.now() - started));

  if (!adapterResult.ok) {
    return fail(adapterResult.code, requestId);
  }

  const reviewPage = sanitizeReviewPage(adapterResult.page, page);
  setReviewsCache(input.db, cacheKey, JSON.stringify(reviewPage));
  return succeed(input, {
    data: reviewPage,
    cached: false,
    requestId,
    upstreamMs,
  });
}

function succeed(
  input: GetReviewsInput,
  ready: {
    data: ReviewPage;
    cached: boolean;
    requestId: string;
    upstreamMs: number;
  },
): Ok<ReviewPage> {
  const charge = chargeCredits(input.db, {
    keyId: input.key.id,
    route: PRODUCT_REVIEWS_ROUTE,
    credits: REVIEW_PAGE_CREDIT_COST,
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

export function sanitizeReviewPage(page: ReviewPage, requestedPage: number): ReviewPage {
  const reviews: Review[] = [];
  for (const review of page.reviews) {
    const body = review.body.trim();
    if (body === "") {
      continue;
    }
    reviews.push({
      ...review,
      body,
      stars: review.stars === 0 ? null : review.stars,
    });
  }
  return {
    page: requestedPage,
    hasMore: page.hasMore,
    reviews,
  };
}

function readCachedPage(body: string): ReviewPage | null {
  try {
    const parsed = reviewPageSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function isRetryableCode(code: ErrorCode): boolean {
  return code === "rate_limited" || code === "upstream_blocked" || code === "internal";
}

function newRequestId(): string {
  return `req_${randomUUID()}`;
}

import { randomUUID } from "node:crypto";
import type { AdapterLookup } from "../adapters/index.js";
import { chargeCredits, getCredits, PRODUCT_CREDIT_COST } from "../billing/credits.js";
import type { Key } from "../billing/keys.js";
import type { SaasReviewsDb } from "../db.js";
import type { Err, ErrorCode, Ok, ProductCard } from "../types.js";
import { loadProductCard } from "./load.js";
import { parseProductUrl } from "./url.js";

export const PRODUCT_BY_URL_ROUTE = "/v1/products/by-url" as const;

export type ProductOutcome = Ok<ProductCard> | Err;

export type GetProductByUrlInput = {
  db: SaasReviewsDb;
  adapters: AdapterLookup;
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
  const adapter = input.adapters.forDirectory(parsed.directory);
  if (adapter === undefined) {
    return fail("directory_unsupported", requestId);
  }

  const remaining = getCredits(input.db, input.key.id);
  if (remaining === null) {
    return fail("unauthorized", requestId);
  }
  if (remaining < PRODUCT_CREDIT_COST) {
    return fail("payment_required", requestId);
  }

  const loaded = await loadProductCard({
    db: input.db,
    adapter,
    directory: parsed.directory,
    directorySlug: parsed.directorySlug,
    url: parsed.url,
  });
  if (!loaded.ok) {
    return fail(loaded.code, requestId);
  }
  return succeed(input, {
    data: loaded.card,
    cached: loaded.cached,
    requestId,
    upstreamMs: loaded.upstreamMs,
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

function isRetryableCode(code: ErrorCode): boolean {
  return code === "rate_limited" || code === "upstream_blocked" || code === "internal";
}

function newRequestId(): string {
  return `req_${randomUUID()}`;
}

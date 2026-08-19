import { randomUUID } from "node:crypto";
import type { AdapterLookup } from "../adapters/index.js";
import { chargeCredits, COMPARE_CREDIT_COST, getCredits } from "../billing/credits.js";
import type { Key } from "../billing/keys.js";
import type { SaasReviewsDb } from "../db.js";
import {
  parseDirectory,
  type CompareResult,
  type Directory,
  type Err,
  type ErrorCode,
  type Ok,
  type ProductCard,
} from "../types.js";
import { loadProductCard } from "./load.js";
import { linkSameAs, productsLinked } from "./match.js";
import { canonicalProductUrl, parseProductId, parseProductUrl } from "./url.js";

export const COMPARE_ROUTE = "/v1/compare" as const;

export type CompareOutcome = Ok<CompareResult> | Err;

export type GetCompareInput = {
  db: SaasReviewsDb;
  adapters: AdapterLookup;
  key: Key;
  a: string | undefined;
  b: string | undefined;
  requestId?: string;
};

const ERROR_MESSAGE: Record<ErrorCode, string> = {
  invalid_request: "Provide a and b as product ids or directory:slug.",
  unauthorized: "Missing or invalid API key.",
  payment_required: "This key has no credits remaining.",
  product_not_found: "No public product matched that id.",
  directory_unsupported: "Directory is not g2 or capterra.",
  unmatched_compare: "Compare ran but the products are not linked.",
  rate_limited: "Rate limit exceeded.",
  upstream_blocked: "The directory blocked this request.",
  internal: "Internal error.",
};

export type ParsedCompareRef =
  | { ok: true; directory: Directory; directorySlug: string; url: string }
  | {
      ok: false;
      code: Extract<ErrorCode, "invalid_request" | "directory_unsupported">;
      message: string;
    };

export function parseCompareRef(raw: string | undefined): ParsedCompareRef {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === "") {
    return {
      ok: false,
      code: "invalid_request",
      message: "Provide a and b as product ids or directory:slug.",
    };
  }

  if (looksLikeUrl(trimmed)) {
    const asUrl = parseProductUrl(trimmed);
    if (asUrl.ok) {
      return asUrl;
    }
    if (asUrl.code === "directory_unsupported") {
      return asUrl;
    }
    return {
      ok: false,
      code: "invalid_request",
      message: "Provide a and b as product ids or directory:slug.",
    };
  }

  const asId = parseProductId(trimmed);
  if (asId !== null) {
    return {
      ok: true,
      directory: asId.directory,
      directorySlug: asId.directorySlug,
      url: canonicalProductUrl(asId.directory, asId.directorySlug),
    };
  }

  const prefixed = /^([a-zA-Z0-9]+):(.+)$/.exec(trimmed);
  if (prefixed) {
    const directory = parseDirectory(prefixed[1]);
    const directorySlug = prefixed[2]?.trim().toLowerCase();
    if (directory === null) {
      return {
        ok: false,
        code: "directory_unsupported",
        message: "Directory is not g2 or capterra.",
      };
    }
    if (directorySlug === undefined || directorySlug === "") {
      return {
        ok: false,
        code: "invalid_request",
        message: "Provide a and b as product ids or directory:slug.",
      };
    }
    return {
      ok: true,
      directory,
      directorySlug,
      url: canonicalProductUrl(directory, directorySlug),
    };
  }

  return {
    ok: false,
    code: "invalid_request",
    message: "Provide a and b as product ids or directory:slug.",
  };
}

function looksLikeUrl(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value) || value.startsWith("www.");
}

export function scoreDelta(
  a: number | null,
  b: number | null,
): number | null {
  if (a === null || b === null) {
    return null;
  }
  return Number((a - b).toFixed(2));
}

export async function compareProducts(
  input: GetCompareInput,
): Promise<CompareOutcome> {
  const requestId = input.requestId ?? newRequestId();
  const leftRef = parseCompareRef(input.a);
  if (!leftRef.ok) {
    return fail(leftRef.code, requestId, leftRef.message);
  }
  const rightRef = parseCompareRef(input.b);
  if (!rightRef.ok) {
    return fail(rightRef.code, requestId, rightRef.message);
  }

  const leftAdapter = input.adapters.forDirectory(leftRef.directory);
  const rightAdapter = input.adapters.forDirectory(rightRef.directory);
  if (leftAdapter === undefined || rightAdapter === undefined) {
    return fail("directory_unsupported", requestId);
  }

  const remaining = getCredits(input.db, input.key.id);
  if (remaining === null) {
    return fail("unauthorized", requestId);
  }
  if (remaining < COMPARE_CREDIT_COST) {
    return fail("payment_required", requestId);
  }

  const [leftLoad, rightLoad] = await Promise.all([
    loadProductCard({
      db: input.db,
      adapter: leftAdapter,
      directory: leftRef.directory,
      directorySlug: leftRef.directorySlug,
      url: leftRef.url,
    }),
    loadProductCard({
      db: input.db,
      adapter: rightAdapter,
      directory: rightRef.directory,
      directorySlug: rightRef.directorySlug,
      url: rightRef.url,
    }),
  ]);

  if (!leftLoad.ok) {
    return fail(leftLoad.code, requestId);
  }
  if (!rightLoad.ok) {
    return fail(rightLoad.code, requestId);
  }

  const linked = productsLinked(leftLoad.card, rightLoad.card);
  const [a, b] = linked
    ? linkSameAs(leftLoad.card, rightLoad.card)
    : stripSameAs(leftLoad.card, rightLoad.card);

  return succeed(input, {
    data: {
      a,
      b,
      scoreDelta: scoreDelta(a.scores.overall, b.scores.overall),
      warning: linked ? null : "unmatched",
    },
    cached: leftLoad.cached && rightLoad.cached,
    requestId,
    upstreamMs: Math.max(leftLoad.upstreamMs, rightLoad.upstreamMs),
  });
}

function stripSameAs(a: ProductCard, b: ProductCard): [ProductCard, ProductCard] {
  return [
    { ...a, sameAs: [] },
    { ...b, sameAs: [] },
  ];
}

function succeed(
  input: GetCompareInput,
  ready: {
    data: CompareResult;
    cached: boolean;
    requestId: string;
    upstreamMs: number;
  },
): Ok<CompareResult> {
  const charge = chargeCredits(input.db, {
    keyId: input.key.id,
    route: COMPARE_ROUTE,
    credits: COMPARE_CREDIT_COST,
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

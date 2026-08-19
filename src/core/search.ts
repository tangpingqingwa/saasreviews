import { randomUUID } from "node:crypto";
import type { AdapterLookup } from "../adapters/index.js";
import { chargeCredits, getCredits, SEARCH_PAGE_CREDIT_COST } from "../billing/credits.js";
import type { Key } from "../billing/keys.js";
import type { SaasReviewsDb } from "../db.js";
import type { Err, ErrorCode, Ok, ProductCard, SearchPage } from "../types.js";
import { listedCards } from "./load.js";
import { nameSimilarity, normalizeName } from "./match.js";
import { paginate, parsePositivePage } from "./page.js";
import { parseRequiredDirectory } from "./url.js";

export const SEARCH_ROUTE = "/v1/search" as const;

export type SearchOutcome = Ok<SearchPage> | Err;

export type GetSearchInput = {
  db: SaasReviewsDb;
  adapters: AdapterLookup;
  key: Key;
  q: string | undefined;
  directory: string | undefined;
  page?: string | number;
  requestId?: string;
};

const ERROR_MESSAGE: Record<ErrorCode, string> = {
  invalid_request: "Provide a q query and directory=g2|capterra.",
  unauthorized: "Missing or invalid API key.",
  payment_required: "This key has no credits remaining.",
  product_not_found: "No public product matched that query.",
  directory_unsupported: "Directory is not g2 or capterra.",
  unmatched_compare: "Compare ran but the products are not linked.",
  rate_limited: "Rate limit exceeded.",
  upstream_blocked: "The directory blocked this request.",
  internal: "Internal error.",
};

export function parseSearchQuery(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    return null;
  }
  return trimmed;
}

export function searchCatalog(
  cards: readonly ProductCard[],
  q: string,
): ProductCard[] {
  const needle = normalizeName(q);
  if (needle === "") {
    return [];
  }
  return cards
    .map((card) => ({ card, score: rankCard(card, q, needle) }))
    .filter((row) => row.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.card.product.name.localeCompare(right.card.product.name);
    })
    .map((row) => row.card);
}

export async function searchProducts(
  input: GetSearchInput,
): Promise<SearchOutcome> {
  const requestId = input.requestId ?? newRequestId();
  const q = parseSearchQuery(input.q);
  if (q === null) {
    return fail("invalid_request", requestId, "Provide a q query parameter.");
  }
  const directory = parseRequiredDirectory(input.directory);
  if (!directory.ok) {
    return fail(directory.code, requestId, directory.message);
  }
  const page = parsePositivePage(input.page);
  if (page === null) {
    return fail("invalid_request", requestId, "page must be a positive integer.");
  }
  const adapter = input.adapters.forDirectory(directory.value);
  if (adapter === undefined) {
    return fail("directory_unsupported", requestId);
  }

  const remaining = getCredits(input.db, input.key.id);
  if (remaining === null) {
    return fail("unauthorized", requestId);
  }
  if (remaining < SEARCH_PAGE_CREDIT_COST) {
    return fail("payment_required", requestId);
  }

  const matches = searchCatalog(listedCards(adapter), q);
  const sliced = paginate(matches, page);
  return succeed(input, {
    data: {
      q,
      directory: directory.value,
      page: sliced.page,
      hasMore: sliced.hasMore,
      products: sliced.items,
    },
    requestId,
  });
}

function rankCard(card: ProductCard, rawQuery: string, needle: string): number {
  const name = normalizeName(card.product.name);
  const slug = card.product.directorySlug.toLowerCase();
  const raw = rawQuery.trim().toLowerCase();
  if (slug === raw || name === needle) {
    return 3;
  }
  if (slug.includes(raw) || name.includes(needle)) {
    return 2;
  }
  const fuzzy = nameSimilarity(card.product.name, rawQuery);
  return fuzzy >= 0.6 ? fuzzy : 0;
}

function succeed(
  input: GetSearchInput,
  ready: { data: SearchPage; requestId: string },
): Ok<SearchPage> {
  const charge = chargeCredits(input.db, {
    keyId: input.key.id,
    route: SEARCH_ROUTE,
    credits: SEARCH_PAGE_CREDIT_COST,
    cached: false,
  });
  return {
    data: ready.data,
    meta: {
      cached: false,
      creditsCharged: charge.ok ? charge.charged : 0,
      requestId: ready.requestId,
      upstreamMs: 0,
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

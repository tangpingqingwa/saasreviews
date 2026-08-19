import { randomUUID } from "node:crypto";
import type { AdapterLookup } from "../adapters/index.js";
import {
  CATEGORY_PAGE_CREDIT_COST,
  chargeCredits,
  getCredits,
} from "../billing/credits.js";
import type { Key } from "../billing/keys.js";
import type { SaasReviewsDb } from "../db.js";
import type {
  CategoryPage,
  Err,
  ErrorCode,
  Ok,
  ProductCard,
} from "../types.js";
import { listedCards } from "./load.js";
import { paginate, parsePositivePage } from "./page.js";
import { parseRequiredDirectory } from "./url.js";

export const CATEGORY_ROUTE = "/v1/categories/{slug}" as const;

export type CategoryOutcome = Ok<CategoryPage> | Err;

export type GetCategoryInput = {
  db: SaasReviewsDb;
  adapters: AdapterLookup;
  key: Key;
  slug: string | undefined;
  directory: string | undefined;
  page?: string | number;
  requestId?: string;
};

const ERROR_MESSAGE: Record<ErrorCode, string> = {
  invalid_request: "Provide a category slug and directory=g2|capterra.",
  unauthorized: "Missing or invalid API key.",
  payment_required: "This key has no credits remaining.",
  product_not_found: "No public products matched that category.",
  directory_unsupported: "Directory is not g2 or capterra.",
  unmatched_compare: "Compare ran but the products are not linked.",
  rate_limited: "Rate limit exceeded.",
  upstream_blocked: "The directory blocked this request.",
  internal: "Internal error.",
};

export function categorySlugFromLabel(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseCategorySlug(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    return null;
  }
  const slug = categorySlugFromLabel(trimmed);
  return slug === "" ? null : slug;
}

export function productsInCategory(
  cards: readonly ProductCard[],
  slug: string,
): ProductCard[] {
  return sortCategoryCards(cards, slug);
}

export async function listCategory(
  input: GetCategoryInput,
): Promise<CategoryOutcome> {
  const requestId = input.requestId ?? newRequestId();
  const slug = parseCategorySlug(input.slug);
  if (slug === null) {
    return fail("invalid_request", requestId, "Provide a category slug.");
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
  if (remaining < CATEGORY_PAGE_CREDIT_COST) {
    return fail("payment_required", requestId);
  }

  const matches = sortCategoryCards(listedCards(adapter), slug);
  const sliced = paginate(matches, page);
  return succeed(input, {
    data: {
      slug,
      directory: directory.value,
      page: sliced.page,
      hasMore: sliced.hasMore,
      products: sliced.items,
    },
    requestId,
  });
}

function sortCategoryCards(cards: readonly ProductCard[], slug: string): ProductCard[] {
  const wanted = categorySlugFromLabel(slug);
  return cards
    .filter((card) =>
      card.categories.some((label) => categorySlugFromLabel(label) === wanted),
    )
    .sort((left, right) => {
      const scoreA = left.scores.overall;
      const scoreB = right.scores.overall;
      if (scoreA !== null && scoreB !== null && scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      if (scoreA === null && scoreB !== null) {
        return 1;
      }
      if (scoreA !== null && scoreB === null) {
        return -1;
      }
      const countA = left.scores.reviewCount ?? -1;
      const countB = right.scores.reviewCount ?? -1;
      if (countB !== countA) {
        return countB - countA;
      }
      return left.product.name.localeCompare(right.product.name);
    });
}

function succeed(
  input: GetCategoryInput,
  ready: { data: CategoryPage; requestId: string },
): Ok<CategoryPage> {
  const charge = chargeCredits(input.db, {
    keyId: input.key.id,
    route: CATEGORY_ROUTE,
    credits: CATEGORY_PAGE_CREDIT_COST,
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

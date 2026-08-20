import { canonicalProductUrl } from "../core/url.js";
import type { Directory, ProductCard } from "../types.js";
import {
  createDirectoryFetch,
  mapHttpFailure,
  type DirectoryFetch,
} from "./http.js";
import {
  parseDirectoryProductHtml,
  parseDirectoryReviewsHtml,
  toProductCard,
  toReviewPage,
} from "./parse.js";
import type {
  AdapterProductRequest,
  AdapterProductResult,
  AdapterReviewsRequest,
  AdapterReviewsResult,
  DirectoryAdapter,
} from "./types.js";

export type LiveAdapterOptions = {
  fetch?: DirectoryFetch;
  now?: () => Date;
};

export function createG2LiveAdapter(options: LiveAdapterOptions = {}): DirectoryAdapter {
  return createLiveAdapter("g2", options);
}

export function createCapterraLiveAdapter(
  options: LiveAdapterOptions = {},
): DirectoryAdapter {
  return createLiveAdapter("capterra", options);
}

function createLiveAdapter(
  directory: Directory,
  options: LiveAdapterOptions,
): DirectoryAdapter {
  const fetchPage = options.fetch ?? createDirectoryFetch();
  const now = options.now ?? (() => new Date());
  return {
    directory,
    async fetchProduct(request: AdapterProductRequest): Promise<AdapterProductResult> {
      if (request.directory !== directory) {
        return { ok: false, code: "directory_unsupported" };
      }
      const url = request.url || canonicalProductUrl(directory, request.directorySlug);
      let response;
      try {
        response = await fetchPage(url);
      } catch {
        return { ok: false, code: "upstream_blocked" };
      }
      const blocked = mapHttpFailure(response.status, response.body);
      if (blocked !== null) {
        return { ok: false, code: blocked };
      }
      const parsed = parseDirectoryProductHtml(response.body, directory);
      if (parsed === null) {
        return { ok: false, code: "product_not_found" };
      }
      const card = toProductCard({
        directory,
        directorySlug: request.directorySlug,
        url,
        parsed,
        extractedAt: now().toISOString(),
      });
      return { ok: true, card };
    },
    async fetchReviews(request: AdapterReviewsRequest): Promise<AdapterReviewsResult> {
      if (request.directory !== directory) {
        return { ok: false, code: "directory_unsupported" };
      }
      const url = reviewsUrl(directory, request.directorySlug, request.page);
      let response;
      try {
        response = await fetchPage(url);
      } catch {
        return { ok: false, code: "upstream_blocked" };
      }
      const blocked = mapHttpFailure(response.status, response.body);
      if (blocked !== null) {
        return { ok: false, code: blocked };
      }
      const parsed = parseDirectoryReviewsHtml(response.body, request.page);
      return { ok: true, page: toReviewPage(parsed, request.page) };
    },
    listProducts(): ProductCard[] {
      return [];
    },
  };
}

function reviewsUrl(directory: Directory, slug: string, page: number): string {
  if (directory === "g2") {
    const base = `https://www.g2.com/products/${encodeURIComponent(slug)}/reviews`;
    return page <= 1 ? base : `${base}?page=${page}`;
  }
  const base = `https://www.capterra.com/p/${encodeURIComponent(slug)}/`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

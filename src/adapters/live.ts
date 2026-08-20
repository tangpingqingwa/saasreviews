import {
  canonicalProductUrl,
  capterraPublicProductUrls,
  g2ReviewsRssUrl,
} from "../core/url.js";
import type { Directory, ProductCard } from "../types.js";
import {
  createDirectoryFetch,
  mapHttpFailure,
  type DirectoryFetch,
  type DirectoryHttpResponse,
} from "./http.js";
import {
  parseDirectoryProductHtml,
  parseDirectoryReviewsHtml,
  parseG2ReviewsRss,
  parseG2ReviewsRssProduct,
  toProductCard,
  toReviewPage,
  type ParsedDirectoryProduct,
  type ParsedDirectoryReviews,
} from "./parse.js";
import type {
  AdapterFailureCode,
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
      const canonical = request.url || canonicalProductUrl(directory, request.directorySlug);
      const fetched = await fetchFirstPublicProduct(
        fetchPage,
        directory,
        request.directorySlug,
        canonical,
      );
      if (!fetched.ok) {
        return { ok: false, code: fetched.code };
      }
      const card = toProductCard({
        directory,
        directorySlug: request.directorySlug,
        url: canonical,
        parsed: fetched.parsed,
        extractedAt: now().toISOString(),
      });
      return { ok: true, card };
    },
    async fetchReviews(request: AdapterReviewsRequest): Promise<AdapterReviewsResult> {
      if (request.directory !== directory) {
        return { ok: false, code: "directory_unsupported" };
      }
      const fetched = await fetchFirstPublicReviews(
        fetchPage,
        directory,
        request.directorySlug,
        request.page,
      );
      if (!fetched.ok) {
        return { ok: false, code: fetched.code };
      }
      return { ok: true, page: toReviewPage(fetched.parsed, request.page) };
    },
    listProducts(): ProductCard[] {
      return [];
    },
  };
}

type FetchedProduct =
  | { ok: true; parsed: ParsedDirectoryProduct }
  | { ok: false; code: AdapterFailureCode };

type FetchedReviews =
  | { ok: true; parsed: ParsedDirectoryReviews }
  | { ok: false; code: AdapterFailureCode };

async function fetchFirstPublicProduct(
  fetchPage: DirectoryFetch,
  directory: Directory,
  slug: string,
  requestedUrl: string,
): Promise<FetchedProduct> {
  let lastFailure: AdapterFailureCode = "upstream_blocked";
  for (const url of productCandidateUrls(directory, slug, requestedUrl)) {
    const response = await getPage(fetchPage, url);
    if (response === null) {
      lastFailure = "upstream_blocked";
      continue;
    }
    const mapped = mapHttpFailure(response.status, response.body);
    if (mapped !== null) {
      lastFailure = mapped;
      continue;
    }
    const parsed = parsePublicProduct(response.body, directory);
    if (parsed !== null) {
      return { ok: true, parsed };
    }
    lastFailure = "product_not_found";
  }
  return { ok: false, code: lastFailure };
}

async function fetchFirstPublicReviews(
  fetchPage: DirectoryFetch,
  directory: Directory,
  slug: string,
  page: number,
): Promise<FetchedReviews> {
  let lastFailure: AdapterFailureCode = "upstream_blocked";
  for (const url of reviewCandidateUrls(directory, slug, page)) {
    const response = await getPage(fetchPage, url);
    if (response === null) {
      lastFailure = "upstream_blocked";
      continue;
    }
    const mapped = mapHttpFailure(response.status, response.body);
    if (mapped !== null) {
      lastFailure = mapped;
      continue;
    }
    const parsed = parsePublicReviews(response.body, page);
    if (parsed !== null) {
      return { ok: true, parsed };
    }
    lastFailure = "product_not_found";
  }
  return { ok: false, code: lastFailure };
}

function parsePublicProduct(
  body: string,
  directory: Directory,
): ParsedDirectoryProduct | null {
  return parseDirectoryProductHtml(body, directory) ?? parseG2ReviewsRssProduct(body);
}

function parsePublicReviews(body: string, page: number): ParsedDirectoryReviews | null {
  const fromHtml = parseDirectoryReviewsHtml(body, page);
  if (fromHtml.reviews.length > 0 || !looksLikeRss(body)) {
    return fromHtml;
  }
  return parseG2ReviewsRss(body, page);
}

function looksLikeRss(body: string): boolean {
  const head = body.slice(0, 800).toLowerCase();
  return head.includes("<rss") || head.includes("<channel");
}

function productCandidateUrls(
  directory: Directory,
  slug: string,
  requestedUrl: string,
): string[] {
  if (directory === "g2") {
    return uniqueUrls([
      requestedUrl,
      canonicalProductUrl("g2", slug),
      g2ReviewsRssUrl(slug),
    ]);
  }
  return capterraPublicProductUrls(slug, requestedUrl);
}

function reviewCandidateUrls(directory: Directory, slug: string, page: number): string[] {
  if (directory === "g2") {
    const html = `https://www.g2.com/products/${encodeURIComponent(slug)}/reviews`;
    return uniqueUrls([
      page <= 1 ? html : `${html}?page=${page}`,
      g2ReviewsRssUrl(slug, page),
    ]);
  }
  const pages = capterraPublicProductUrls(slug).flatMap((url) => {
    if (page <= 1) {
      return [url];
    }
    const joiner = url.includes("?") ? "&" : "?";
    return [`${url}${joiner}page=${page}`];
  });
  return uniqueUrls(pages);
}

async function getPage(
  fetchPage: DirectoryFetch,
  url: string,
): Promise<DirectoryHttpResponse | null> {
  try {
    return await fetchPage(url);
  } catch {
    return null;
  }
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (url === "" || seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push(url);
  }
  return out;
}

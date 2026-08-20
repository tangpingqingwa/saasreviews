import type { Directory, ProductCard, Review, ReviewPage } from "../types.js";
import { productIdFor } from "../core/url.js";
import {
  asRecord,
  firstMatch,
  isoFromUnknown,
  jsonLdType,
  numberFromUnknown,
  parseJsonLdBlocks,
  stripTags,
  textFromUnknown,
  walkJsonLd,
} from "./html.js";

export const DEFAULT_STAR_MAX = 5;

export type ParsedDirectoryProduct = {
  name: string;
  overall: number | null;
  max: number;
  reviewCount: number | null;
  pricingTeaser: string | null;
  categories: string[];
};

export type ParsedDirectoryReviews = {
  reviews: Review[];
  hasMore: boolean;
};

export function parseDirectoryProductHtml(
  html: string,
  directory: Directory,
): ParsedDirectoryProduct | null {
  const nodes = walkJsonLd(parseJsonLdBlocks(html));
  const productNode = nodes.find((node) => isProductLike(jsonLdType(node)));
  const name =
    textFromUnknown(productNode?.name) ??
    firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    firstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ??
    firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (name === null) {
    return null;
  }

  const ratingNode = ratingFrom(productNode) ?? firstAggregateRating(nodes);
  const overall = parseOverall(ratingNode);
  const max = parseMax(ratingNode);
  const reviewCount = parseReviewCount(ratingNode, html);

  return {
    name: cleanProductName(name, directory),
    overall,
    max,
    reviewCount,
    pricingTeaser: parsePricingTeaser(html, productNode),
    categories: parseCategories(html, productNode),
  };
}

export function parseDirectoryReviewsHtml(
  html: string,
  page: number,
): ParsedDirectoryReviews {
  const fromJsonLd = reviewsFromJsonLd(html);
  const fromDom = fromJsonLd.length > 0 ? [] : reviewsFromDom(html);
  const reviews =
    fromJsonLd.length > 0
      ? fromJsonLd
      : fromDom.length > 0
        ? fromDom
        : reviewsFromRss(html);
  return {
    reviews: reviews.filter((review) => review.body.trim() !== ""),
    hasMore: inferHasMore(html, page, reviews.length),
  };
}

/** Public G2 `reviews.rss` channel. Name only — no invented overall. */
export function parseG2ReviewsRssProduct(
  xml: string,
): ParsedDirectoryProduct | null {
  if (!looksLikeRss(xml)) {
    return null;
  }
  const channel = firstMatch(xml, /<channel\b[^>]*>([\s\S]*?)<\/channel>/i);
  if (channel === null) {
    return null;
  }
  const rawTitle = firstMatch(channel, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (rawTitle === null) {
    return null;
  }
  const name = cleanProductName(rawTitle, "g2");
  if (name === "") {
    return null;
  }
  return {
    name,
    overall: null,
    max: DEFAULT_STAR_MAX,
    reviewCount: null,
    pricingTeaser: null,
    categories: [],
  };
}

/** Public G2 `reviews.rss` items. Star 0 stays null. */
export function parseG2ReviewsRss(
  xml: string,
  page: number,
): ParsedDirectoryReviews | null {
  if (!looksLikeRss(xml)) {
    return null;
  }
  const reviews: Review[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) {
    const parsed = reviewFromRssItem(match[1] ?? "");
    if (parsed !== null) {
      reviews.push(parsed);
    }
  }
  if (reviews.length === 0 && parseG2ReviewsRssProduct(xml) === null) {
    return null;
  }
  return {
    reviews,
    hasMore: page === 1 && reviews.length > 0,
  };
}

export function toProductCard(input: {
  directory: Directory;
  directorySlug: string;
  url: string;
  parsed: ParsedDirectoryProduct;
  extractedAt: string;
}): ProductCard {
  return {
    product: {
      id: productIdFor(input.directory, input.directorySlug),
      directory: input.directory,
      directorySlug: input.directorySlug,
      url: input.url,
      name: input.parsed.name,
    },
    sameAs: [],
    scores: {
      overall: input.parsed.overall,
      max: input.parsed.max,
      reviewCount: input.parsed.reviewCount,
    },
    pricingTeaser: input.parsed.pricingTeaser,
    categories: input.parsed.categories,
    extractedAt: input.extractedAt,
  };
}

export function toReviewPage(
  parsed: ParsedDirectoryReviews,
  page: number,
): ReviewPage {
  return {
    page,
    hasMore: parsed.hasMore,
    reviews: parsed.reviews,
  };
}

function isProductLike(types: string[]): boolean {
  return types.some((type) =>
    type === "softwareapplication" ||
    type === "product" ||
    type === "application",
  );
}

function ratingFrom(node: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (node === undefined) {
    return null;
  }
  return asRecord(node.aggregateRating);
}

function firstAggregateRating(nodes: Record<string, unknown>[]): Record<string, unknown> | null {
  for (const node of nodes) {
    if (jsonLdType(node).includes("aggregaterating")) {
      return node;
    }
    const nested = asRecord(node.aggregateRating);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function parseOverall(rating: Record<string, unknown> | null): number | null {
  if (rating === null) {
    return null;
  }
  const value = numberFromUnknown(rating.ratingValue);
  if (value === null) {
    return null;
  }
  // Missing public score stays null. Never invent 0 from an empty widget.
  if (value === 0) {
    const count = numberFromUnknown(rating.reviewCount ?? rating.ratingCount);
    if (count === null || count === 0) {
      return null;
    }
  }
  return value;
}

function parseMax(rating: Record<string, unknown> | null): number {
  if (rating !== null) {
    const stated = numberFromUnknown(rating.bestRating);
    if (stated !== null && stated > 0) {
      return stated;
    }
  }
  return DEFAULT_STAR_MAX;
}

function parseReviewCount(
  rating: Record<string, unknown> | null,
  html: string,
): number | null {
  if (rating !== null) {
    const count = numberFromUnknown(rating.reviewCount ?? rating.ratingCount);
    if (count !== null) {
      return Math.trunc(count);
    }
  }
  const fromMeta = firstMatch(
    html,
    /itemprop=["']reviewCount["'][^>]*content=["'](\d+)/i,
  );
  if (fromMeta !== null) {
    const parsed = Number(fromMeta);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parsePricingTeaser(
  html: string,
  productNode: Record<string, unknown> | undefined,
): string | null {
  const offers = productNode === undefined ? null : asRecord(productNode.offers);
  if (offers !== null) {
    const price = textFromUnknown(offers.price ?? offers.lowPrice);
    const currency = textFromUnknown(offers.priceCurrency);
    if (price !== null) {
      return currency === null ? price : `${currency} ${price}`;
    }
    const description = textFromUnknown(offers.description ?? offers.category);
    if (description !== null) {
      return description;
    }
  }
  return (
    firstMatch(html, /data-pricing-teaser=["']([^"']+)["']/i) ??
    firstMatch(
      html,
      /<(?:div|span|p)[^>]*(?:pricing|starting-price)[^>]*>([\s\S]*?)<\/(?:div|span|p)>/i,
    )
  );
}

function parseCategories(
  html: string,
  productNode: Record<string, unknown> | undefined,
): string[] {
  const fromNode = categoriesFromNode(productNode);
  if (fromNode.length > 0) {
    return unique(fromNode);
  }
  const crumbs: string[] = [];
  const re =
    /<(?:a|span)[^>]*(?:breadcrumb|category)[^>]*>([\s\S]*?)<\/(?:a|span)>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const label = stripTags(match[1] ?? "");
    if (label !== "" && !/home|products|software/i.test(label)) {
      crumbs.push(label);
    }
  }
  return unique(crumbs);
}

function categoriesFromNode(node: Record<string, unknown> | undefined): string[] {
  if (node === undefined) {
    return [];
  }
  const raw = node.applicationCategory ?? node.category ?? node.applicationSubCategory;
  if (typeof raw === "string") {
    return raw
      .split(/[|,]/)
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => textFromUnknown(item))
      .filter((item): item is string => item !== null);
  }
  return [];
}

function reviewsFromJsonLd(html: string): Review[] {
  const reviews: Review[] = [];
  for (const node of walkJsonLd(parseJsonLdBlocks(html))) {
    if (jsonLdType(node).includes("review")) {
      const parsed = reviewFromNode(node);
      if (parsed !== null) {
        reviews.push(parsed);
      }
      continue;
    }
    const nested = node.review;
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const record = asRecord(item);
        if (record === null) {
          continue;
        }
        const parsed = reviewFromNode(record);
        if (parsed !== null) {
          reviews.push(parsed);
        }
      }
    }
  }
  return reviews;
}

function reviewsFromDom(html: string): Review[] {
  const reviews: Review[] = [];
  const articleRe =
    /<(?:article|div)[^>]*(?:data-review|class=["'][^"']*review(?:-card|-item)?[^"']*["'])[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
  let match: RegExpExecArray | null;
  while ((match = articleRe.exec(html)) !== null) {
    const chunk = match[1] ?? "";
    const body =
      firstMatch(chunk, /<(?:p|div)[^>]*(?:review-body|review-text|body)[^>]*>([\s\S]*?)<\/(?:p|div)>/i) ??
      firstMatch(chunk, /<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (body === null) {
      continue;
    }
    const cleaned = stripTags(body);
    if (cleaned === "") {
      continue;
    }
    const title =
      firstMatch(chunk, /<(?:h2|h3|h4)[^>]*>([\s\S]*?)<\/(?:h2|h3|h4)>/i) ??
      firstMatch(chunk, /itemprop=["']name["'][^>]*>([\s\S]*?)</i);
    const starsRaw =
      firstMatch(chunk, /(?:data-rating|itemprop=["']ratingValue["'][^>]*content)=["']([^"']+)["']/i) ??
      firstMatch(chunk, /(\d+(?:\.\d+)?)\s*(?:\/\s*5|stars?)/i);
    const stars = starsRaw === null ? null : numberFromUnknown(starsRaw);
    reviews.push({
      id: firstMatch(chunk, /data-review-id=["']([^"']+)["']/i),
      title: title === null ? null : stripTags(title),
      body: cleaned,
      stars: stars === 0 ? null : stars,
      createdAt: firstMatch(chunk, /datetime=["']([^"']+)["']/i),
      reviewerTitle: firstMatch(chunk, /(?:reviewer-title|job-title)[^>]*>([\s\S]*?)</i),
      industry: firstMatch(chunk, /(?:industry)[^>]*>([\s\S]*?)</i),
      companySize: firstMatch(chunk, /(?:company-size)[^>]*>([\s\S]*?)</i),
      validated: null,
    });
  }
  return reviews;
}

function reviewFromNode(node: Record<string, unknown>): Review | null {
  const body =
    textFromUnknown(node.reviewBody ?? node.description ?? node.text) ??
    textFromUnknown(asRecord(node.reviewBody)?.text);
  if (body === null) {
    return null;
  }
  const rating = asRecord(node.reviewRating);
  const stars = rating === null ? null : numberFromUnknown(rating.ratingValue);
  const author = asRecord(node.author);
  return {
    id: textFromUnknown(node["@id"] ?? node.identifier ?? node.url),
    title: textFromUnknown(node.name ?? node.headline),
    body,
    stars: stars === 0 ? null : stars,
    createdAt: isoFromUnknown(node.datePublished ?? node.dateCreated),
    reviewerTitle: textFromUnknown(author?.jobTitle ?? node.authorTitle),
    industry: textFromUnknown(author?.industry ?? node.industry),
    companySize: textFromUnknown(node.companySize),
    validated: null,
  };
}

function inferHasMore(html: string, page: number, reviewCount: number): boolean {
  if (/rel=["']next["']/i.test(html) || /data-has-more=["']true["']/i.test(html)) {
    return true;
  }
  const pageMatch = new RegExp(`page=${page + 1}\\b`, "i").exec(html);
  if (pageMatch !== null) {
    return true;
  }
  return reviewCount > 0 && /next\s*(?:page)?/i.test(html);
}

function looksLikeRss(body: string): boolean {
  const head = body.slice(0, 800).toLowerCase();
  return head.includes("<rss") || head.includes("<channel");
}

function reviewFromRssItem(item: string): Review | null {
  const description =
    firstMatch(item, /<description\b[^>]*>([\s\S]*?)<\/description>/i) ??
    firstMatch(item, /<content:encoded\b[^>]*>([\s\S]*?)<\/content:encoded>/i);
  if (description === null) {
    return null;
  }
  const body = stripTags(description);
  if (body === "" || /sign in to (view|read)/i.test(body)) {
    return null;
  }
  const titleRaw = firstMatch(item, /<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleRaw === null ? null : stripTags(titleRaw);
  const stars = starsFromRssBody(body);
  const createdAt =
    firstMatch(item, /<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i) ??
    firstMatch(item, /<dc:date\b[^>]*>([\s\S]*?)<\/dc:date>/i);
  const guid =
    firstMatch(item, /<guid\b[^>]*>([\s\S]*?)<\/guid>/i) ??
    firstMatch(item, /<link\b[^>]*>([\s\S]*?)<\/link>/i);
  const industry = firstMatch(body, /Review from[^\n.]*?\bin\s+([^.<]+)/i);
  const reviewerTitle = firstMatch(body, /role:\s*([^<\n]+)/i);
  const companySize = firstMatch(body, /size:\s*([^<\n]+)/i);
  return {
    id: guid === null ? null : stripTags(guid),
    title: title === "" ? null : title,
    body,
    stars: stars === 0 ? null : stars,
    createdAt: createdAt === null ? null : isoFromUnknown(createdAt),
    reviewerTitle: reviewerTitle === null ? null : stripTags(reviewerTitle),
    industry: industry === null ? null : stripTags(industry),
    companySize: companySize === null ? null : stripTags(companySize),
    validated: /verified user/i.test(body) ? true : null,
  };
}

function starsFromRssBody(body: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*stars?\b/i.exec(body);
  if (match === null) {
    return null;
  }
  return numberFromUnknown(match[1]);
}

function reviewsFromRss(body: string): Review[] {
  const parsed = parseG2ReviewsRss(body, 1);
  return parsed === null ? [] : parsed.reviews;
}

function cleanProductName(name: string, directory: Directory): string {
  const stripped = stripTags(name)
    .replace(/\s*[|\u2013\u2014-]\s*(?:reviews?|g2|capterra).*$/i, "")
    .replace(/\s+reviews$/i, "")
    .trim();
  if (directory === "g2") {
    return stripped.replace(/\s+G2\s*$/i, "").trim();
  }
  return stripped;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

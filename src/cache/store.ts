import type { SaasReviewsDb } from "../db.js";
import type { ErrorCode } from "../types.js";

export const PRODUCT_TTL_MS = 24 * 60 * 60 * 1000;
export const REVIEW_TTL_MS = 12 * 60 * 60 * 1000;
export const PRODUCT_NOT_FOUND_TTL_MS = 12 * 60 * 60 * 1000;

export type CacheTombstoneCode = Extract<ErrorCode, "product_not_found">;

export type CacheLookup =
  | { hit: false }
  | { hit: true; kind: "product" | "reviews"; body: string }
  | { hit: true; kind: "tombstone"; errorCode: CacheTombstoneCode };

type CacheRow = {
  kind: string;
  body: string | null;
  error_code: string | null;
  expires_at: string;
};

export function productCacheKey(directory: string, slug: string): string {
  return `product:${directory}:${slug}`;
}

export function reviewsCacheKey(
  directory: string,
  slug: string,
  page: number,
): string {
  return `reviews:${directory}:${slug}:${page}`;
}

export function getCacheEntry(
  db: SaasReviewsDb,
  cacheKey: string,
  now: Date = new Date(),
): CacheLookup {
  const row = db
    .prepare<[string], CacheRow>(
      `SELECT kind, body, error_code, expires_at
       FROM cache_entries WHERE cache_key = ?`,
    )
    .get(cacheKey);
  if (row === undefined || row.expires_at <= now.toISOString()) {
    return { hit: false };
  }
  if ((row.kind === "product" || row.kind === "reviews") && row.body !== null) {
    return { hit: true, kind: row.kind, body: row.body };
  }
  if (row.kind === "tombstone" && row.error_code === "product_not_found") {
    return { hit: true, kind: "tombstone", errorCode: row.error_code };
  }
  return { hit: false };
}

export function setProductCache(
  db: SaasReviewsDb,
  cacheKey: string,
  body: string,
  now: Date = new Date(),
  ttlMs: number = PRODUCT_TTL_MS,
): void {
  upsertCache(db, {
    cacheKey,
    kind: "product",
    body,
    errorCode: null,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });
}

export function setReviewsCache(
  db: SaasReviewsDb,
  cacheKey: string,
  body: string,
  now: Date = new Date(),
  ttlMs: number = REVIEW_TTL_MS,
): void {
  upsertCache(db, {
    cacheKey,
    kind: "reviews",
    body,
    errorCode: null,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });
}

export function setCacheTombstone(
  db: SaasReviewsDb,
  cacheKey: string,
  errorCode: CacheTombstoneCode,
  now: Date = new Date(),
  ttlMs: number = PRODUCT_NOT_FOUND_TTL_MS,
): void {
  upsertCache(db, {
    cacheKey,
    kind: "tombstone",
    body: null,
    errorCode,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });
}

function upsertCache(
  db: SaasReviewsDb,
  entry: {
    cacheKey: string;
    kind: string;
    body: string | null;
    errorCode: string | null;
    expiresAt: string;
  },
): void {
  db.prepare(
    `INSERT INTO cache_entries (cache_key, kind, body, error_code, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       kind = excluded.kind,
       body = excluded.body,
       error_code = excluded.error_code,
       expires_at = excluded.expires_at`,
  ).run(entry.cacheKey, entry.kind, entry.body, entry.errorCode, entry.expiresAt);
}

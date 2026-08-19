import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createG2FixtureAdapter } from "../src/adapters/g2/fixture.js";
import type { DirectoryAdapter } from "../src/adapters/types.js";
import { buildApp } from "../src/app.js";
import { getCredits } from "../src/billing/credits.js";
import { createKey } from "../src/billing/keys.js";
import { parseProductUrl } from "../src/core/url.js";
import { openDatabase } from "../src/db.js";
import {
  productCardSchema,
  type ErrorCode,
  type ProductCard,
} from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "sr_test_g2_product";
const G2_PRODUCTS = join(ROOT, "tests/fixtures/g2/products");

type OkBody = {
  data: ProductCard;
  meta: {
    cached: boolean;
    creditsCharged: number;
    requestId: string;
    upstreamMs: number;
  };
};

type ErrBody = {
  error: { code: ErrorCode; message: string; retryable: boolean };
  meta: { creditsCharged: number; requestId: string };
};

async function appWithKey(credits = 100, adapter?: DirectoryAdapter) {
  const db = openDatabase(":memory:");
  createKey(db, { secret: KEY, credits });
  const app = await buildApp({
    db,
    adapter: adapter ?? createG2FixtureAdapter(),
  });
  after(async () => {
    await app.close();
    db.close();
  });
  return { app, db };
}

function auth() {
  return { authorization: `Bearer ${KEY}` };
}

test("G2 fixture catalog has 10 product cards with max 5", () => {
  const files = readdirSync(G2_PRODUCTS).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 10);
  const slugs = new Set<string>();
  for (const file of files) {
    const adapter = createG2FixtureAdapter();
    slugs.add(file.replace(/\.json$/, ""));
    assert.equal(adapter.directory, "g2");
  }
  assert.equal(slugs.size, 10);
});

test("parseProductUrl accepts G2 product and /reviews paths", () => {
  const urls = [
    "https://www.g2.com/products/notion/reviews",
    "https://g2.com/products/notion",
    "www.g2.com/products/Notion/reviews",
    "https://www.g2.com/products/notion/pricing",
  ];
  for (const url of urls) {
    const parsed = parseProductUrl(url);
    assert.equal(parsed.ok, true, url);
    if (parsed.ok) {
      assert.equal(parsed.directory, "g2");
      assert.equal(parsed.directorySlug, "notion");
    }
  }
});

test("parseProductUrl rejects Capterra and unknown directories before fetch", () => {
  const capterra = parseProductUrl("https://www.capterra.com/p/notion");
  assert.equal(capterra.ok, false);
  if (!capterra.ok) {
    assert.equal(capterra.code, "directory_unsupported");
  }
  const gartner = parseProductUrl("https://www.gartner.com/reviews/market/foo");
  assert.equal(gartner.ok, false);
  if (!gartner.ok) {
    assert.equal(gartner.code, "directory_unsupported");
  }
  const empty = parseProductUrl("");
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.equal(empty.code, "invalid_request");
  }
});

test("GET /v1/products/by-url returns Notion name and numeric overall (SPEC 1)", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/notion/reviews",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(productCardSchema.safeParse(body.data).success, true);
  assert.equal(body.data.product.name, "Notion");
  assert.equal(body.data.product.directory, "g2");
  assert.equal(body.data.product.directorySlug, "notion");
  assert.equal(body.data.product.id, "sr_prod_g2_notion");
  assert.equal(typeof body.data.scores.overall, "number");
  assert.notEqual(body.data.scores.overall, null);
  assert.equal(body.data.scores.max, 5);
  assert.equal(body.meta.creditsCharged, 1);
  assert.equal(body.meta.cached, false);
  assert.deepEqual(body.data.sameAs, []);
});

test("missing overall stays null, never 0 (SPEC 6)", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/ghostwriter/reviews",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(body.data.product.name, "Ghostwriter Labs");
  assert.equal(body.data.scores.overall, null);
  assert.notEqual(body.data.scores.overall, 0);
  assert.equal(body.data.scores.max, 5);
  assert.equal(body.data.scores.reviewCount, null);
});

test("unknown G2 slug is product_not_found 404 with 0 credits", async () => {
  const { app, db } = await appWithKey(12);
  const keyRow = db
    .prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1")
    .get();
  assert.ok(keyRow);
  const response = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/not-a-real-saas/reviews",
    headers: auth(),
  });
  assert.equal(response.statusCode, 404);
  const body = response.json() as ErrBody;
  assert.equal(body.error.code, "product_not_found");
  assert.equal(body.meta.creditsCharged, 0);
  assert.equal(getCredits(db, keyRow.id), 12);
});

test("Capterra URL is directory_unsupported 422 and does not charge", async () => {
  const { app, db } = await appWithKey(8);
  const keyRow = db
    .prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1")
    .get();
  assert.ok(keyRow);
  const response = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.capterra.com/p/slack/",
    headers: auth(),
  });
  assert.equal(response.statusCode, 422);
  const body = response.json() as ErrBody;
  assert.equal(body.error.code, "directory_unsupported");
  assert.equal(body.meta.creditsCharged, 0);
  assert.equal(getCredits(db, keyRow.id), 8);
});

test("by-url without a key is 401; zero credits is 402", async () => {
  const { app } = await appWithKey(0);
  const denied = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/notion/reviews",
  });
  assert.equal(denied.statusCode, 401);
  assert.equal((denied.json() as ErrBody).error.code, "unauthorized");
  assert.equal((denied.json() as ErrBody).meta.creditsCharged, 0);

  const broke = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/notion/reviews",
    headers: auth(),
  });
  assert.equal(broke.statusCode, 402);
  assert.equal((broke.json() as ErrBody).error.code, "payment_required");
  assert.equal((broke.json() as ErrBody).meta.creditsCharged, 0);
});

test("second by-url hit is cached and still charges 1", async () => {
  const { app } = await appWithKey();
  const first = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/slack/reviews",
    headers: auth(),
  });
  const second = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/slack/reviews",
    headers: auth(),
  });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal((first.json() as OkBody).meta.cached, false);
  assert.equal((second.json() as OkBody).meta.cached, true);
  assert.equal((second.json() as OkBody).meta.creditsCharged, 1);
  assert.equal((second.json() as OkBody).meta.upstreamMs, 0);
});

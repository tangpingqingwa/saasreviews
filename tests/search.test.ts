import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createAppAdapters } from "../src/adapters/index.js";
import { buildApp } from "../src/app.js";
import { getCredits } from "../src/billing/credits.js";
import { createKey } from "../src/billing/keys.js";
import { searchCatalog } from "../src/core/search.js";
import { openDatabase } from "../src/db.js";
import {
  searchPageSchema,
  type ErrorCode,
  type ProductCard,
  type SearchPage,
} from "../src/types.js";

const KEY = "sr_test_search";

type OkBody = {
  data: SearchPage;
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

async function appWithKey(credits = 100) {
  const db = openDatabase(":memory:");
  createKey(db, { secret: KEY, credits });
  const app = await buildApp({
    db,
    adapters: createAppAdapters(),
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

test("searchCatalog ranks exact name above substring", () => {
  const notion: ProductCard = {
    product: {
      id: "sr_prod_g2_notion",
      directory: "g2",
      directorySlug: "notion",
      url: "https://www.g2.com/products/notion/reviews",
      name: "Notion",
    },
    sameAs: [],
    scores: { overall: 4.7, max: 5, reviewCount: 1 },
    pricingTeaser: null,
    categories: [],
    extractedAt: "2026-01-15T12:00:00.000Z",
  };
  const slack: ProductCard = {
    ...notion,
    product: {
      ...notion.product,
      id: "sr_prod_g2_slack",
      directorySlug: "slack",
      url: "https://www.g2.com/products/slack/reviews",
      name: "Slack",
    },
  };
  const hits = searchCatalog([slack, notion], "notion");
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.product.directorySlug, "notion");
});

test("GET /v1/search returns G2 Notion for q=notion", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/search?q=notion&directory=g2",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(searchPageSchema.safeParse(body.data).success, true);
  assert.equal(body.data.q, "notion");
  assert.equal(body.data.directory, "g2");
  assert.equal(body.data.page, 1);
  assert.equal(body.data.hasMore, false);
  assert.ok(body.data.products.length >= 1);
  assert.equal(body.data.products[0]?.product.name, "Notion");
  assert.equal(body.data.products[0]?.product.directory, "g2");
  assert.equal(body.meta.creditsCharged, 1);
});

test("Capterra search stays on Capterra cards", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/search?q=obsidian&directory=capterra",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(body.data.directory, "capterra");
  assert.equal(body.data.products[0]?.product.directory, "capterra");
  assert.equal(body.data.products[0]?.product.directorySlug, "obsidian");
  assert.equal(body.meta.creditsCharged, 1);
});

test("empty search page is 200 with zero products, still 1 credit", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/search?q=zzzz-not-a-product&directory=g2",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.deepEqual(body.data.products, []);
  assert.equal(body.data.hasMore, false);
  assert.equal(body.meta.creditsCharged, 1);
});

test("search requires q and directory; TrustRadius is 422", async () => {
  const { app, db } = await appWithKey(9);
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);

  const missingQ = await app.inject({
    method: "GET",
    url: "/v1/search?directory=g2",
    headers: auth(),
  });
  assert.equal(missingQ.statusCode, 400);
  assert.equal((missingQ.json() as ErrBody).error.code, "invalid_request");

  const missingDir = await app.inject({
    method: "GET",
    url: "/v1/search?q=notion",
    headers: auth(),
  });
  assert.equal(missingDir.statusCode, 400);
  assert.equal((missingDir.json() as ErrBody).error.code, "invalid_request");

  const unsupported = await app.inject({
    method: "GET",
    url: "/v1/search?q=notion&directory=trustradius",
    headers: auth(),
  });
  assert.equal(unsupported.statusCode, 422);
  assert.equal((unsupported.json() as ErrBody).error.code, "directory_unsupported");
  assert.equal(getCredits(db, keyRow.id), 9);
});

test("search without a key is 401; zero credits is 402", async () => {
  const { app } = await appWithKey(0);
  const denied = await app.inject({
    method: "GET",
    url: "/v1/search?q=notion&directory=g2",
  });
  assert.equal(denied.statusCode, 401);
  const broke = await app.inject({
    method: "GET",
    url: "/v1/search?q=notion&directory=g2",
    headers: auth(),
  });
  assert.equal(broke.statusCode, 402);
});

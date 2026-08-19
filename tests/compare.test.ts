import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createG2FixtureAdapter } from "../src/adapters/g2/fixture.js";
import {
  createAppAdapters,
  registryOf,
  type AdapterLookup,
} from "../src/adapters/index.js";
import { buildApp } from "../src/app.js";
import { getCredits } from "../src/billing/credits.js";
import { createKey } from "../src/billing/keys.js";
import { parseCompareRef, scoreDelta } from "../src/core/compare.js";
import { productsLinked } from "../src/core/match.js";
import { openDatabase } from "../src/db.js";
import {
  compareResultSchema,
  productCardSchema,
  type CompareResult,
  type ErrorCode,
  type ProductCard,
} from "../src/types.js";

const KEY = "sr_test_compare";

type OkBody = {
  data: CompareResult;
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

async function appWithKey(credits = 100, adapters?: AdapterLookup) {
  const db = openDatabase(":memory:");
  createKey(db, { secret: KEY, credits });
  const app = await buildApp({
    db,
    adapters: adapters ?? createAppAdapters(),
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

function card(partial: {
  id: string;
  directory: "g2" | "capterra";
  directorySlug: string;
  url: string;
  name: string;
  overall: number | null;
}): ProductCard {
  return {
    product: {
      id: partial.id,
      directory: partial.directory,
      directorySlug: partial.directorySlug,
      url: partial.url,
      name: partial.name,
    },
    sameAs: [],
    scores: { overall: partial.overall, max: 5, reviewCount: 10 },
    pricingTeaser: null,
    categories: [],
    extractedAt: "2026-01-15T12:00:00.000Z",
  };
}

test("parseCompareRef accepts ids, directory:slug, and product URLs", () => {
  const id = parseCompareRef("sr_prod_g2_notion");
  assert.equal(id.ok, true);
  if (id.ok) {
    assert.equal(id.directory, "g2");
    assert.equal(id.directorySlug, "notion");
  }
  const prefixed = parseCompareRef("capterra:obsidian");
  assert.equal(prefixed.ok, true);
  if (prefixed.ok) {
    assert.equal(prefixed.directory, "capterra");
    assert.equal(prefixed.directorySlug, "obsidian");
  }
  const url = parseCompareRef("https://www.g2.com/products/slack/reviews");
  assert.equal(url.ok, true);
  if (url.ok) {
    assert.equal(url.directorySlug, "slack");
  }
  const unsupported = parseCompareRef("trustradius:slack");
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) {
    assert.equal(unsupported.code, "directory_unsupported");
  }
  const empty = parseCompareRef("");
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.equal(empty.code, "invalid_request");
  }
});

test("scoreDelta is null unless both overalls are numbers", () => {
  assert.equal(scoreDelta(4.7, 4.5), 0.2);
  assert.equal(scoreDelta(null, 4.5), null);
  assert.equal(scoreDelta(4.7, null), null);
  assert.equal(scoreDelta(null, null), null);
});

test("Notion vs Motion names do not merge", () => {
  const notion = card({
    id: "sr_prod_g2_notion",
    directory: "g2",
    directorySlug: "notion",
    url: "https://www.g2.com/products/notion/reviews",
    name: "Notion",
    overall: 4.7,
  });
  const motion = card({
    id: "sr_prod_g2_motion",
    directory: "g2",
    directorySlug: "motion",
    url: "https://www.g2.com/products/motion/reviews",
    name: "Motion",
    overall: 4.4,
  });
  assert.equal(productsLinked(notion, motion), false);
});

test("GET /v1/compare of two known products charges 2 and returns both cards (SPEC 4)", async () => {
  const { app, db } = await appWithKey(20);
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);

  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_g2_slack",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(compareResultSchema.safeParse(body.data).success, true);
  assert.equal(productCardSchema.safeParse(body.data.a).success, true);
  assert.equal(productCardSchema.safeParse(body.data.b).success, true);
  assert.equal(body.data.a.product.name, "Notion");
  assert.equal(body.data.b.product.name, "Slack");
  assert.equal(body.data.a.scores.overall, 4.7);
  assert.equal(body.data.b.scores.overall, 4.5);
  assert.equal(body.data.scoreDelta, 0.2);
  assert.equal(body.data.warning, "unmatched");
  assert.deepEqual(body.data.a.sameAs, []);
  assert.deepEqual(body.data.b.sameAs, []);
  assert.equal(body.meta.creditsCharged, 2);
  assert.equal(getCredits(db, keyRow.id), 18);
});

test("compare via directory:slug works the same as ids", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=g2:notion&b=capterra:slack",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(body.data.a.product.directory, "g2");
  assert.equal(body.data.b.product.directory, "capterra");
  assert.equal(body.data.warning, "unmatched");
  assert.equal(body.meta.creditsCharged, 2);
});

test("unmatched names return both cards and warning unmatched (SPEC 5)", async () => {
  const { app, db } = await appWithKey(10);
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);

  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_ghostwriter&b=sr_prod_capterra_ghostnote",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(body.data.a.product.name, "Ghostwriter Labs");
  assert.equal(body.data.b.product.name, "Ghostnote Labs");
  assert.equal(body.data.a.scores.overall, null);
  assert.equal(body.data.b.scores.overall, null);
  assert.equal(body.data.scoreDelta, null);
  assert.equal(body.data.warning, "unmatched");
  assert.deepEqual(body.data.a.sameAs, []);
  assert.deepEqual(body.data.b.sameAs, []);
  assert.equal(body.meta.creditsCharged, 2);
  assert.equal(getCredits(db, keyRow.id), 8);
});

test("same-name cross-directory compare links sameAs and still charges 2", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_capterra_notion",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(body.data.warning, null);
  assert.equal(body.data.a.sameAs[0]?.id, "sr_prod_capterra_notion");
  assert.equal(body.data.b.sameAs[0]?.id, "sr_prod_g2_notion");
  assert.equal(body.data.scoreDelta, 0);
  assert.equal(body.meta.creditsCharged, 2);
});

test("same-directory unmatched names still return warning unmatched", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_g2_slack",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(body.data.warning, "unmatched");
  assert.deepEqual(body.data.a.sameAs, []);
  assert.deepEqual(body.data.b.sameAs, []);
  assert.equal(body.meta.creditsCharged, 2);
});

test("missing overall does not invent a scoreDelta", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_ghostwriter&b=sr_prod_g2_notion",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(body.data.a.scores.overall, null);
  assert.equal(body.data.scoreDelta, null);
  assert.equal(body.data.warning, "unmatched");
  assert.equal(body.meta.creditsCharged, 2);
});

test("compare of a missing product is 404 and charges 0", async () => {
  const { app, db } = await appWithKey(6);
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_g2_not-a-real-saas",
    headers: auth(),
  });
  assert.equal(response.statusCode, 404);
  const body = response.json() as ErrBody;
  assert.equal(body.error.code, "product_not_found");
  assert.equal(body.meta.creditsCharged, 0);
  assert.equal(getCredits(db, keyRow.id), 6);
});

test("unsupported directory compare is 422 and does not charge", async () => {
  const { app, db } = await appWithKey(6);
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=trustradius:slack",
    headers: auth(),
  });
  assert.equal(response.statusCode, 422);
  assert.equal((response.json() as ErrBody).error.code, "directory_unsupported");
  assert.equal(getCredits(db, keyRow.id), 6);
});

test("Capterra-only registry cannot compare a Capterra id against a missing G2 adapter", async () => {
  const { app, db } = await appWithKey(6, registryOf(createG2FixtureAdapter()));
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_capterra_notion",
    headers: auth(),
  });
  assert.equal(response.statusCode, 422);
  assert.equal((response.json() as ErrBody).error.code, "directory_unsupported");
  assert.equal(getCredits(db, keyRow.id), 6);
});

test("compare without a key is 401; one credit is 402", async () => {
  const { app, db } = await appWithKey(1);
  const denied = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_g2_slack",
  });
  assert.equal(denied.statusCode, 401);
  assert.equal((denied.json() as ErrBody).error.code, "unauthorized");

  const broke = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_g2_slack",
    headers: auth(),
  });
  assert.equal(broke.statusCode, 402);
  assert.equal((broke.json() as ErrBody).error.code, "payment_required");
  assert.equal(
    getCredits(db, db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get()!.id),
    1,
  );
});

test("warm product cache still charges 2 for compare", async () => {
  const { app } = await appWithKey();
  await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/notion/reviews",
    headers: auth(),
  });
  await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/slack/reviews",
    headers: auth(),
  });
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_g2_slack",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(body.meta.cached, true);
  assert.equal(body.meta.creditsCharged, 2);
  assert.equal(body.meta.upstreamMs, 0);
});

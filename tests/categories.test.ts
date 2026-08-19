import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createAppAdapters } from "../src/adapters/index.js";
import { buildApp } from "../src/app.js";
import { getCredits } from "../src/billing/credits.js";
import { createKey } from "../src/billing/keys.js";
import { categorySlugFromLabel } from "../src/core/categories.js";
import { openDatabase } from "../src/db.js";
import {
  categoryPageSchema,
  type CategoryPage,
  type ErrorCode,
} from "../src/types.js";

const KEY = "sr_test_categories";

type OkBody = {
  data: CategoryPage;
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

test("categorySlugFromLabel is directory-style kebab", () => {
  assert.equal(categorySlugFromLabel("Project Management"), "project-management");
  assert.equal(categorySlugFromLabel("CRM"), "crm");
  assert.equal(categorySlugFromLabel("Knowledge Base"), "knowledge-base");
});

test("GET /v1/categories/crm?directory=g2 returns HubSpot and Salesforce", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/categories/crm?directory=g2",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(categoryPageSchema.safeParse(body.data).success, true);
  assert.equal(body.data.slug, "crm");
  assert.equal(body.data.directory, "g2");
  assert.equal(body.data.page, 1);
  const slugs = body.data.products.map((card) => card.product.directorySlug).sort();
  assert.deepEqual(slugs, ["hubspot", "salesforce"]);
  for (const card of body.data.products) {
    assert.equal(card.product.directory, "g2");
    assert.ok(card.categories.some((label) => categorySlugFromLabel(label) === "crm"));
  }
  assert.equal(body.meta.creditsCharged, 1);
});

test("Capterra project-management category stays on Capterra cards", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/categories/project-management?directory=capterra",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(body.data.directory, "capterra");
  assert.ok(body.data.products.length >= 3);
  const slugs = body.data.products.map((card) => card.product.directorySlug);
  assert.ok(slugs.includes("asana"));
  assert.ok(slugs.includes("clickup"));
  assert.ok(slugs.includes("monday"));
  assert.ok(slugs.includes("notion"));
  for (const card of body.data.products) {
    assert.equal(card.product.directory, "capterra");
  }
  assert.equal(body.meta.creditsCharged, 1);
});

test("unknown category is an empty page, still 1 credit", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/categories/not-a-real-category?directory=g2",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.deepEqual(body.data.products, []);
  assert.equal(body.data.hasMore, false);
  assert.equal(body.meta.creditsCharged, 1);
});

test("category requires directory; TrustRadius is 422", async () => {
  const { app, db } = await appWithKey(8);
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);

  const missing = await app.inject({
    method: "GET",
    url: "/v1/categories/crm",
    headers: auth(),
  });
  assert.equal(missing.statusCode, 400);
  assert.equal((missing.json() as ErrBody).error.code, "invalid_request");

  const unsupported = await app.inject({
    method: "GET",
    url: "/v1/categories/crm?directory=gartner",
    headers: auth(),
  });
  assert.equal(unsupported.statusCode, 422);
  assert.equal((unsupported.json() as ErrBody).error.code, "directory_unsupported");
  assert.equal(getCredits(db, keyRow.id), 8);
});

test("category without a key is 401; zero credits is 402", async () => {
  const { app } = await appWithKey(0);
  const denied = await app.inject({
    method: "GET",
    url: "/v1/categories/crm?directory=g2",
  });
  assert.equal(denied.statusCode, 401);
  const broke = await app.inject({
    method: "GET",
    url: "/v1/categories/crm?directory=g2",
    headers: auth(),
  });
  assert.equal(broke.statusCode, 402);
});

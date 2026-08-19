import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createG2FixtureAdapter } from "../src/adapters/g2/fixture.js";
import { buildApp } from "../src/app.js";
import { getCredits } from "../src/billing/credits.js";
import { createKey } from "../src/billing/keys.js";
import { sanitizeReviewPage } from "../src/core/reviews.js";
import { openDatabase } from "../src/db.js";
import {
  reviewPageSchema,
  type ErrorCode,
  type ReviewPage,
} from "../src/types.js";

const KEY = "sr_test_g2_reviews";

type OkBody = {
  data: ReviewPage;
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
    adapter: createG2FixtureAdapter(),
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

test("GET /v1/products/{id}/reviews returns public bodies (SPEC 3)", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_notion/reviews",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody;
  assert.equal(reviewPageSchema.safeParse(body.data).success, true);
  assert.equal(body.data.page, 1);
  assert.equal(body.data.hasMore, true);
  assert.ok(body.data.reviews.length >= 1);
  for (const review of body.data.reviews) {
    assert.equal(typeof review.body, "string");
    assert.ok(review.body.length > 0);
    assert.equal(review.body.includes("login"), false);
    assert.equal(review.body.includes("sign in to continue"), false);
  }
  assert.equal(body.data.reviews[0]?.title, "Replaced our wiki and half our tickets");
  assert.equal(body.meta.creditsCharged, 1);
});

test("review page 2 is a real second page, empty page is 200 not 404", async () => {
  const { app } = await appWithKey();
  const page2 = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_notion/reviews?page=2",
    headers: auth(),
  });
  assert.equal(page2.statusCode, 200);
  const second = page2.json() as OkBody;
  assert.equal(second.data.page, 2);
  assert.equal(second.data.hasMore, false);
  assert.equal(second.data.reviews.length, 1);
  assert.equal(second.data.reviews[0]?.title, "Templates saved onboarding");
  assert.match(second.data.reviews[0]?.body ?? "", /clone a public template/i);

  const empty = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_ghostwriter/reviews",
    headers: auth(),
  });
  assert.equal(empty.statusCode, 200);
  const emptyBody = empty.json() as OkBody;
  assert.deepEqual(emptyBody.data.reviews, []);
  assert.equal(emptyBody.data.hasMore, false);
  assert.equal(emptyBody.meta.creditsCharged, 1);

  const pastEnd = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_notion/reviews?page=9",
    headers: auth(),
  });
  assert.equal(pastEnd.statusCode, 200);
  const past = pastEnd.json() as OkBody;
  assert.equal(past.data.page, 9);
  assert.deepEqual(past.data.reviews, []);
  assert.equal(past.data.hasMore, false);
});

test("unknown product id and bad page do not invent reviews", async () => {
  const { app, db } = await appWithKey(9);
  const keyRow = db
    .prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1")
    .get();
  assert.ok(keyRow);

  const missing = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_not-a-real-saas/reviews",
    headers: auth(),
  });
  assert.equal(missing.statusCode, 404);
  assert.equal((missing.json() as ErrBody).error.code, "product_not_found");
  assert.equal((missing.json() as ErrBody).meta.creditsCharged, 0);

  const capterraId = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_capterra_notion/reviews",
    headers: auth(),
  });
  assert.equal(capterraId.statusCode, 404);
  assert.equal((capterraId.json() as ErrBody).error.code, "product_not_found");

  const badPage = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_notion/reviews?page=0",
    headers: auth(),
  });
  assert.equal(badPage.statusCode, 400);
  assert.equal((badPage.json() as ErrBody).error.code, "invalid_request");
  assert.equal(getCredits(db, keyRow.id), 9);
});

test("sanitizeReviewPage drops empty bodies and never keeps star 0", () => {
  const cleaned = sanitizeReviewPage(
    {
      page: 1,
      hasMore: false,
      reviews: [
        {
          id: "keep",
          title: "ok",
          body: "  public text  ",
          stars: 0,
          createdAt: null,
          reviewerTitle: null,
          industry: null,
          companySize: null,
          validated: null,
        },
        {
          id: "drop",
          title: null,
          body: "   ",
          stars: 5,
          createdAt: null,
          reviewerTitle: null,
          industry: null,
          companySize: null,
          validated: null,
        },
      ],
    },
    1,
  );
  assert.equal(cleaned.reviews.length, 1);
  assert.equal(cleaned.reviews[0]?.body, "public text");
  assert.equal(cleaned.reviews[0]?.stars, null);
});

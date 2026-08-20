import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAppAdapters,
  createCapterraLiveAdapter,
  createG2LiveAdapter,
  registryOf,
} from "../src/adapters/index.js";
import { looksLikeBotWall, mapHttpFailure } from "../src/adapters/http.js";
import {
  parseDirectoryProductHtml,
  parseDirectoryReviewsHtml,
  parseG2ReviewsRss,
  parseG2ReviewsRssProduct,
} from "../src/adapters/parse.js";
import { buildApp } from "../src/app.js";
import { getCredits } from "../src/billing/credits.js";
import { createKey } from "../src/billing/keys.js";
import { parseAdapterMode } from "../src/config.js";
import { productsLinked } from "../src/core/match.js";
import { openDatabase } from "../src/db.js";
import type { DirectoryHttpResponse } from "../src/adapters/http.js";
import type { CompareResult, ErrorCode, ProductCard, ReviewPage } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HTML = join(ROOT, "tests/fixtures/html");
const KEY = "sr_test_live_directories";

const G2_NOTION = readFileSync(join(HTML, "g2-notion.html"), "utf8");
const G2_GHOST = readFileSync(join(HTML, "g2-ghostwriter.html"), "utf8");
const G2_NOTION_P2 = readFileSync(join(HTML, "g2-notion-reviews-page-2.html"), "utf8");
const G2_NOTION_RSS = readFileSync(join(HTML, "g2-notion.rss"), "utf8");
const CAP_NOTION = readFileSync(join(HTML, "capterra-notion.html"), "utf8");
const CAP_GHOST = readFileSync(join(HTML, "capterra-ghostnote.html"), "utf8");
const CAP_CA_NOTION = readFileSync(join(HTML, "capterra-ca-notion.html"), "utf8");
const BOT_WALL = readFileSync(join(HTML, "bot-wall.html"), "utf8");

type OkBody<T> = {
  data: T;
  meta: { cached: boolean; creditsCharged: number; requestId: string; upstreamMs: number };
};

type ErrBody = {
  error: { code: ErrorCode; message: string; retryable: boolean };
  meta: { creditsCharged: number; requestId: string };
};

function htmlResponse(body: string, status = 200): DirectoryHttpResponse {
  return { status, body, headers: { "content-type": "text/html" } };
}

function recordedFetch(url: string): Promise<DirectoryHttpResponse> {
  if (url.includes("g2.com/products/notion") && url.includes("page=2")) {
    return Promise.resolve(htmlResponse(G2_NOTION_P2));
  }
  if (url.includes("g2.com/products/notion/reviews.rss")) {
    return Promise.resolve({
      status: 200,
      body: G2_NOTION_RSS,
      headers: { "content-type": "application/rss+xml" },
    });
  }
  if (url.includes("g2.com/products/notion")) {
    return Promise.resolve(htmlResponse(G2_NOTION));
  }
  if (url.includes("g2.com/products/ghostwriter")) {
    return Promise.resolve(htmlResponse(G2_GHOST));
  }
  if (url.includes("g2.com/products/missing-saas")) {
    return Promise.resolve(htmlResponse("not found", 404));
  }
  if (url.includes("g2.com/products/blocked")) {
    return Promise.resolve(htmlResponse(BOT_WALL, 403));
  }
  if (url.includes("capterra.com/p/notion")) {
    return Promise.resolve(htmlResponse(CAP_NOTION));
  }
  if (url.includes("capterra.com/p/ghostnote")) {
    return Promise.resolve(htmlResponse(CAP_GHOST));
  }
  if (url.includes("capterra.com/p/missing-saas") || url.includes("capterra.com/software/missing-saas")) {
    return Promise.resolve(htmlResponse("gone", 404));
  }
  if (url.includes("capterra.ca/software/186596/notion")) {
    return Promise.resolve(htmlResponse(CAP_CA_NOTION));
  }
  if (url.includes("capterra.") && (url.includes("/p/") || url.includes("/software/"))) {
    return Promise.resolve(htmlResponse(BOT_WALL, 403));
  }
  throw new Error(`recorded fetch has no HTML for ${url}`);
}

function walledThenPublicFetch(url: string): Promise<DirectoryHttpResponse> {
  if (url.includes("g2.com/products/notion/reviews.rss")) {
    return Promise.resolve({
      status: 200,
      body: G2_NOTION_RSS,
      headers: { "content-type": "application/rss+xml" },
    });
  }
  if (url.includes("capterra.ca/software/186596/notion")) {
    return Promise.resolve(htmlResponse(CAP_CA_NOTION));
  }
  if (url.includes("g2.com") || url.includes("capterra.")) {
    return Promise.resolve(htmlResponse(BOT_WALL, 403));
  }
  throw new Error(`walled fetch has no recording for ${url}`);
}

function liveAdapters() {
  return registryOf(
    createG2LiveAdapter({ fetch: recordedFetch }),
    createCapterraLiveAdapter({ fetch: recordedFetch }),
  );
}

async function appWithLive(credits = 100) {
  const db = openDatabase(":memory:");
  createKey(db, { secret: KEY, credits });
  const app = await buildApp({ db, adapters: liveAdapters() });
  after(async () => {
    await app.close();
    db.close();
  });
  return { app, db };
}

function auth() {
  return { authorization: `Bearer ${KEY}` };
}

test("default adapter mode is fixture; live is explicit env only", () => {
  assert.equal(parseAdapterMode({}), "fixture");
  assert.equal(parseAdapterMode({ SAASREVIEWS_LIVE_DIRECTORIES: "1" }), "live");
  assert.equal(
    parseAdapterMode({
      SAASREVIEWS_LIVE_DIRECTORIES: "1",
      SAASREVIEWS_FIXTURE_ONLY: "1",
    }),
    "fixture",
  );
  assert.equal(createAppAdapters({}).forDirectory("g2")?.directory, "g2");
  assert.equal(
    createAppAdapters({ SAASREVIEWS_FIXTURE_ONLY: "1" }).forDirectory("capterra")
      ?.listProducts().length,
    10,
  );
  assert.equal(
    createAppAdapters({ SAASREVIEWS_LIVE_DIRECTORIES: "1" }).forDirectory("g2")
      ?.listProducts().length,
    0,
  );
});

test("G2 HTML parser reads name and overall; missing score stays null", () => {
  const notion = parseDirectoryProductHtml(G2_NOTION, "g2");
  assert.ok(notion);
  assert.equal(notion.name, "Notion");
  assert.equal(notion.overall, 4.7);
  assert.equal(notion.max, 5);
  assert.equal(notion.reviewCount, 2143);
  assert.notEqual(notion.overall, 0);

  const ghost = parseDirectoryProductHtml(G2_GHOST, "g2");
  assert.ok(ghost);
  assert.equal(ghost.overall, null);
  assert.notEqual(ghost.overall, 0);
  assert.equal(ghost.max, 5);
});

test("Capterra HTML parser uses the same schema and stated max 5", () => {
  const notion = parseDirectoryProductHtml(CAP_NOTION, "capterra");
  assert.ok(notion);
  assert.equal(notion.name, "Notion");
  assert.equal(notion.overall, 4.7);
  assert.equal(notion.max, 5);
  assert.equal(notion.reviewCount, 1890);

  const ghost = parseDirectoryProductHtml(CAP_GHOST, "capterra");
  assert.ok(ghost);
  assert.equal(ghost.overall, null);
  assert.notEqual(ghost.overall, 0);
});

test("G2 reviews.rss parser keeps name and public bodies; overall stays null", () => {
  const product = parseG2ReviewsRssProduct(G2_NOTION_RSS);
  assert.ok(product);
  assert.equal(product.name, "Notion");
  assert.equal(product.overall, null);
  assert.equal(product.max, 5);
  assert.equal(product.reviewCount, null);

  const page = parseG2ReviewsRss(G2_NOTION_RSS, 1);
  assert.ok(page);
  assert.ok(page.reviews.length >= 1);
  assert.equal(page.reviews[0]?.stars, 4.5);
  assert.ok((page.reviews[0]?.body.length ?? 0) > 0);
  assert.equal(page.reviews.some((review) => review.stars === 0), false);
});

test("review parser keeps public bodies and never keeps star 0", () => {
  const page1 = parseDirectoryReviewsHtml(G2_NOTION, 1);
  assert.equal(page1.hasMore, true);
  assert.ok(page1.reviews.length >= 1);
  assert.ok(page1.reviews[0]?.body.includes("Public review"));
  assert.equal(page1.reviews[0]?.body.includes("sign in"), false);

  const capterra = parseDirectoryReviewsHtml(CAP_NOTION, 1);
  assert.equal(capterra.reviews[0]?.title, "Wiki the whole company lives in");
  assert.ok((capterra.reviews[0]?.body.length ?? 0) > 0);
});

test("bot wall and 403 map to upstream_blocked, not invented scores", () => {
  assert.equal(looksLikeBotWall(BOT_WALL), true);
  assert.equal(mapHttpFailure(403, BOT_WALL), "upstream_blocked");
  assert.equal(mapHttpFailure(404, "missing"), "product_not_found");
  assert.equal(mapHttpFailure(429, "slow down"), "upstream_blocked");
});

test("live G2 by-url uses recorded HTML and never invents stars (SPEC 1, 6)", async () => {
  const { app } = await appWithLive();
  const response = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/notion/reviews",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody<ProductCard>;
  assert.equal(body.data.product.name, "Notion");
  assert.equal(body.data.product.directory, "g2");
  assert.equal(typeof body.data.scores.overall, "number");
  assert.equal(body.data.scores.max, 5);
  assert.equal(body.meta.creditsCharged, 1);
});

test("live Capterra by-url returns the shared card schema (SPEC 2)", async () => {
  const { app } = await appWithLive();
  const response = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.capterra.com/p/notion/",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody<ProductCard>;
  assert.equal(body.data.product.directory, "capterra");
  assert.equal(body.data.scores.max, 5);
  assert.notEqual(body.data.scores.overall, null);
});

test("live missing overall stays null, never 0", async () => {
  const { app } = await appWithLive();
  const g2 = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/ghostwriter/reviews",
    headers: auth(),
  });
  assert.equal((g2.json() as OkBody<ProductCard>).data.scores.overall, null);

  const capterra = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.capterra.com/p/ghostnote/",
    headers: auth(),
  });
  assert.equal((capterra.json() as OkBody<ProductCard>).data.scores.overall, null);
});

test("live 404 is product_not_found and charges 0", async () => {
  const { app, db } = await appWithLive(5);
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);
  const response = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/missing-saas/reviews",
    headers: auth(),
  });
  assert.equal(response.statusCode, 404);
  assert.equal((response.json() as ErrBody).error.code, "product_not_found");
  assert.equal((response.json() as ErrBody).meta.creditsCharged, 0);
  assert.equal(getCredits(db, keyRow.id), 5);
});

test("live bot wall is upstream_blocked 503 and charges 0", async () => {
  const { app, db } = await appWithLive(5);
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);
  const response = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/blocked/reviews",
    headers: auth(),
  });
  assert.equal(response.statusCode, 503);
  assert.equal((response.json() as ErrBody).error.code, "upstream_blocked");
  assert.equal((response.json() as ErrBody).error.retryable, true);
  assert.equal(getCredits(db, keyRow.id), 5);
});

test("live reviews return public bodies (SPEC 3)", async () => {
  const { app } = await appWithLive();
  const first = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_notion/reviews",
    headers: auth(),
  });
  assert.equal(first.statusCode, 200);
  const page = (first.json() as OkBody<ReviewPage>).data;
  assert.ok(page.reviews.length >= 1);
  assert.ok(page.reviews[0]?.body.includes("Public review"));
  assert.equal(page.hasMore, true);

  const second = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_notion/reviews?page=2",
    headers: auth(),
  });
  assert.equal(second.statusCode, 200);
  assert.equal((second.json() as OkBody<ReviewPage>).data.page, 2);
  assert.match(
    (second.json() as OkBody<ReviewPage>).data.reviews[0]?.body ?? "",
    /clone a public template/i,
  );
});

test("live G2 falls back to public reviews.rss when HTML is a bot wall", async () => {
  const db = openDatabase(":memory:");
  createKey(db, { secret: KEY, credits: 10 });
  const app = await buildApp({
    db,
    adapters: registryOf(
      createG2LiveAdapter({ fetch: walledThenPublicFetch }),
      createCapterraLiveAdapter({ fetch: walledThenPublicFetch }),
    ),
  });
  after(async () => {
    await app.close();
    db.close();
  });

  const product = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.g2.com/products/notion/reviews",
    headers: auth(),
  });
  assert.equal(product.statusCode, 200);
  const card = product.json() as OkBody<ProductCard>;
  assert.equal(card.data.product.name, "Notion");
  assert.equal(card.data.product.directory, "g2");
  assert.equal(card.data.scores.overall, null);
  assert.equal(card.data.scores.max, 5);
  assert.equal(card.meta.creditsCharged, 1);

  const reviews = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_notion/reviews?page=1",
    headers: auth(),
  });
  assert.equal(reviews.statusCode, 200);
  const page = (reviews.json() as OkBody<ReviewPage>).data;
  assert.ok(page.reviews.length >= 1);
  assert.ok((page.reviews[0]?.body.length ?? 0) > 0);
  assert.equal(page.reviews[0]?.stars, 4.5);
});

test("live Capterra falls back to a regional public page when .com is walled", async () => {
  const db = openDatabase(":memory:");
  createKey(db, { secret: KEY, credits: 10 });
  const app = await buildApp({
    db,
    adapters: registryOf(
      createG2LiveAdapter({ fetch: walledThenPublicFetch }),
      createCapterraLiveAdapter({ fetch: walledThenPublicFetch }),
    ),
  });
  after(async () => {
    await app.close();
    db.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/v1/products/by-url?url=https://www.capterra.com/p/186596/Notion/",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody<ProductCard>;
  assert.equal(body.data.product.name, "Notion");
  assert.equal(body.data.product.directory, "capterra");
  assert.equal(body.data.product.url, "https://www.capterra.com/p/notion/");
  assert.equal(body.data.scores.overall, 4.7);
  assert.equal(body.data.scores.max, 5);
  assert.equal(body.data.scores.reviewCount, 2799);
  assert.equal(body.meta.creditsCharged, 1);
});

test("live unmatched compare returns both cards + warning unmatched (SPEC 5)", async () => {
  const { app, db } = await appWithLive(10);
  const keyRow = db.prepare<[], { id: string }>("SELECT id FROM keys LIMIT 1").get();
  assert.ok(keyRow);
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_ghostwriter&b=sr_prod_capterra_ghostnote",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody<CompareResult>;
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

test("live same-name compare still links; Notion vs invented Motion does not", async () => {
  const { app } = await appWithLive();
  const response = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_capterra_notion",
    headers: auth(),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as OkBody<CompareResult>;
  assert.equal(body.data.warning, null);
  assert.equal(body.data.a.sameAs[0]?.id, "sr_prod_capterra_notion");
  assert.equal(body.meta.creditsCharged, 2);

  const notion = body.data.a;
  const motion: ProductCard = {
    ...notion,
    product: {
      ...notion.product,
      id: "sr_prod_g2_motion",
      directorySlug: "motion",
      name: "Motion",
    },
    sameAs: [],
  };
  assert.equal(productsLinked(notion, motion), false);
});

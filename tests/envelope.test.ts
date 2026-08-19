import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  createKey,
  DEFAULT_FREE_CREDITS,
  hashSecret,
  lookupKey,
} from "../src/billing/keys.js";
import { recordUsageEvent } from "../src/billing/usage.js";
import { loadConfig, parseListenPort } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { sendErr, sendOk, httpStatusFor, isRetryable } from "../src/http/envelope.js";
import { ERROR_CODES, type ErrorCode } from "../src/types.js";
import { buildApp } from "../src/app.js";

const TEST_KEY = "sr_test_bootstrap_fixture";

const HTTP_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  payment_required: 402,
  product_not_found: 404,
  directory_unsupported: 422,
  unmatched_compare: 200,
  rate_limited: 429,
  upstream_blocked: 503,
  internal: 500,
};

test("parseListenPort defaults unset and empty to 3000 and rejects out of range", () => {
  assert.equal(parseListenPort(undefined), 3000);
  assert.equal(parseListenPort(""), 3000);
  assert.throws(() => parseListenPort("0"), /PORT must be an integer/);
  assert.throws(() => parseListenPort("abc"), /PORT must be an integer/);
  assert.throws(() => parseListenPort("70000"), /PORT must be an integer/);
});

test("loadConfig requires SAASREVIEWS_DATABASE in production", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "production" }),
    /SAASREVIEWS_DATABASE is required in production/,
  );
  const config = loadConfig({
    NODE_ENV: "production",
    SAASREVIEWS_DATABASE: "/tmp/saasreviews.sqlite",
    SAASREVIEWS_BOOTSTRAP_KEY: "sr_test_dev",
  });
  assert.equal(config.databasePath, "/tmp/saasreviews.sqlite");
  assert.equal(config.bootstrapKey, "sr_test_dev");
});

test("createKey stores a hash and lookupKey finds only sr_live_ / sr_test_ secrets", () => {
  const db = openDatabase(":memory:");
  after(() => db.close());

  const secret = "sr_live_unit_fixture";
  const created = createKey(db, { secret, credits: 7 });
  const found = lookupKey(db, secret);
  assert.equal(found?.id, created.id);
  assert.equal(found?.prefix, "sr_live");
  assert.equal(found?.credits, 7);
  assert.equal(lookupKey(db, "sr_live_unknown"), null);
  assert.equal(lookupKey(db, "not-a-key"), null);
  assert.equal(lookupKey(db, "ck_live_clipapi"), null);
  assert.equal(lookupKey(db, "sk_live_stripe_collision"), null);
  assert.throws(() => createKey(db, { secret: "nope" }), /sr_live_|sr_test_/);
  assert.throws(() => createKey(db, { secret: "sr_live_" }), /sr_live_|sr_test_/);

  const row = db
    .prepare<[string], { hash: string }>("SELECT hash FROM keys WHERE id = ?")
    .get(created.id);
  assert.ok(row);
  assert.notEqual(row.hash, secret);
  assert.equal(row.hash, hashSecret(secret));
});

test("error codes map to SPEC HTTP status and retryable flags", () => {
  for (const code of ERROR_CODES) {
    assert.equal(httpStatusFor(code), HTTP_BY_CODE[code]);
    const retryable =
      code === "rate_limited" || code === "upstream_blocked" || code === "internal";
    assert.equal(isRetryable(code), retryable);
  }
  assert.equal(httpStatusFor("directory_unsupported"), 422);
  assert.equal(httpStatusFor("product_not_found"), 404);
  assert.equal(httpStatusFor("unmatched_compare"), 200);
});

test("sendOk / sendErr write the frozen envelope; errors charge 0", async () => {
  const app = await buildApp();
  after(() => app.close());

  app.get("/__ok", async (_request, reply) => {
    return sendOk(
      reply,
      { ping: true },
      {
        cached: false,
        creditsCharged: 1,
        upstreamMs: 4,
        requestId: "req_ok",
      },
    );
  });

  for (const code of ERROR_CODES) {
    app.get(`/__err/${code}`, async (_request, reply) => {
      return sendErr(reply, code, `fixture ${code}`, `req_${code}`);
    });
  }

  const ok = await app.inject({ method: "GET", url: "/__ok" });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), {
    data: { ping: true },
    meta: {
      cached: false,
      creditsCharged: 1,
      requestId: "req_ok",
      upstreamMs: 4,
    },
  });

  for (const code of ERROR_CODES) {
    const response = await app.inject({ method: "GET", url: `/__err/${code}` });
    assert.equal(response.statusCode, HTTP_BY_CODE[code], code);
    const body = response.json() as {
      error: { code: ErrorCode; message: string; retryable: boolean };
      meta: { creditsCharged: number; requestId: string };
    };
    assert.equal(body.error.code, code);
    assert.equal(body.error.message, `fixture ${code}`);
    assert.equal(body.error.retryable, isRetryable(code));
    assert.equal(body.meta.creditsCharged, 0);
    assert.equal(body.meta.requestId, `req_${code}`);
  }
});

test("GET /v1/me without bearer is 401 with 0 credits", async () => {
  const app = await buildApp();
  after(() => app.close());

  const cases = [
    {},
    { authorization: "" },
    { authorization: "Basic nope" },
    { authorization: "Bearer" },
    { authorization: "Bearer sr_test_unknown" },
    { authorization: "Bearer ck_live_not_a_saasreviews_key" },
    { authorization: "Bearer sk_live_stripe_shaped" },
  ];

  for (const headers of cases) {
    const response = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers,
    });
    assert.equal(response.statusCode, 401);
    const body = response.json() as {
      error: { code: string; retryable: boolean };
      meta: { creditsCharged: number; requestId: string };
    };
    assert.equal(body.error.code, "unauthorized");
    assert.equal(body.error.retryable, false);
    assert.equal(body.meta.creditsCharged, 0);
    assert.match(body.meta.requestId, /^req_/);
  }
});

test("bootstrap test key → GET /v1/me shows credits", async () => {
  const app = await buildApp({ bootstrapKey: TEST_KEY });
  after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${TEST_KEY}` },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      key: { id: string; prefix: string };
      plan: string;
      creditsRemaining: number;
      rpm: number;
    };
    meta: {
      cached: boolean;
      creditsCharged: number;
      requestId: string;
      upstreamMs: number;
    };
  };
  assert.equal(body.data.key.prefix, "sr_test");
  assert.ok(body.data.key.id.length > 0);
  assert.equal(body.data.plan, "free");
  assert.equal(body.data.creditsRemaining, DEFAULT_FREE_CREDITS);
  assert.equal(body.data.rpm, 30);
  assert.equal(body.meta.cached, false);
  assert.equal(body.meta.creditsCharged, 0);
  assert.equal(body.meta.upstreamMs, 0);
  assert.match(body.meta.requestId, /^req_/);
});

test("GET /v1/usage requires a key and returns daily buckets without charging", async () => {
  const db = openDatabase(":memory:");
  after(() => db.close());

  const secret = "sr_live_usage_fixture";
  const key = createKey(db, { secret, credits: 100 });
  recordUsageEvent(db, {
    keyId: key.id,
    route: "/v1/products/by-url",
    credits: 1,
    cached: false,
    createdAt: "2026-01-15T12:00:00.000Z",
  });
  recordUsageEvent(db, {
    keyId: key.id,
    route: "/v1/compare",
    credits: 2,
    cached: true,
    createdAt: "2026-01-15T18:00:00.000Z",
  });

  const app = await buildApp({ db });
  after(() => app.close());

  const denied = await app.inject({ method: "GET", url: "/v1/usage" });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json().error.code, "unauthorized");
  assert.equal(denied.json().meta.creditsCharged, 0);

  const bad = await app.inject({
    method: "GET",
    url: "/v1/usage?from=15-01-2026&to=2026-01-16",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, "invalid_request");
  assert.equal(bad.json().meta.creditsCharged, 0);

  const response = await app.inject({
    method: "GET",
    url: "/v1/usage?from=2026-01-15&to=2026-01-16",
    headers: { authorization: `Bearer ${secret}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      from: string;
      to: string;
      days: Array<{ date: string; credits: number; requests: number }>;
    };
    meta: { creditsCharged: number; cached: boolean };
  };
  assert.equal(body.data.from, "2026-01-15");
  assert.equal(body.data.to, "2026-01-16");
  assert.deepEqual(body.data.days, [
    { date: "2026-01-15", credits: 3, requests: 2 },
    { date: "2026-01-16", credits: 0, requests: 0 },
  ]);
  assert.equal(body.meta.creditsCharged, 0);
  assert.equal(body.meta.cached, false);
});

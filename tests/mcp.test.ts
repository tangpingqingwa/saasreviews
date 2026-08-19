import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAppAdapters } from "../src/adapters/index.js";
import { buildApp } from "../src/app.js";
import { getCredits } from "../src/billing/credits.js";
import { createKey } from "../src/billing/keys.js";
import { openDatabase } from "../src/db.js";
import { MCP_PATH, MCP_PROTOCOL_VERSION } from "../src/mcp/server.js";
import {
  COMPARE_SAAS_TOOL,
  GET_SAAS_TOOL,
  LIST_REVIEWS_TOOL,
} from "../src/mcp/tools.js";
import {
  compareResultSchema,
  productCardSchema,
  reviewPageSchema,
  type CompareResult,
  type ErrorCode,
  type ProductCard,
  type ReviewPage,
} from "../src/types.js";

const KEY = "sr_test_mcp_fixture";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOTION_G2_URL = "https://www.g2.com/products/notion/reviews";
const NOTION_CAPTERRA_URL = "https://www.capterra.com/p/184621/notion/";

type OkBody<T> = {
  data: T;
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

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  structuredContent: OkBody<unknown> | ErrBody;
  isError: boolean;
};

type JsonRpcOk = {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
};

async function appWithKey(credits = 100) {
  const db = openDatabase(":memory:");
  const key = createKey(db, { secret: KEY, credits });
  const app = await buildApp({
    db,
    adapters: createAppAdapters(),
  });
  after(async () => {
    await app.close();
    db.close();
  });
  return { app, db, key };
}

function auth() {
  return { authorization: `Bearer ${KEY}` };
}

async function rpc(
  app: Awaited<ReturnType<typeof buildApp>>,
  method: string,
  params?: unknown,
  headers: Record<string, string> = auth(),
) {
  return app.inject({
    method: "POST",
    url: MCP_PATH,
    headers,
    payload: { jsonrpc: "2.0", id: 1, method, params },
  });
}

async function callTool(
  app: Awaited<ReturnType<typeof buildApp>>,
  name: string,
  args: Record<string, unknown> = {},
) {
  const response = await rpc(app, "tools/call", { name, arguments: args });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json() as JsonRpcOk;
  const result = body.result as ToolResult;
  assert.ok(result);
  assert.equal(typeof result.isError, "boolean");
  return result;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) {
      out.push(...walkTs(path));
    } else if (name.name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

test("GET /llms.txt is public and matches the checked-in file", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({ method: "GET", url: "/llms.txt" });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"] ?? "", /text\/plain/);
  const onDisk = readFileSync(join(ROOT, "llms.txt"), "utf8");
  assert.equal(response.body, onDisk);
  assert.match(onDisk, /get_saas/);
  assert.match(onDisk, /list_reviews/);
  assert.match(onDisk, /compare_saas/);
  assert.match(onDisk, /When not to call/i);
  assert.match(onDisk, /not complete vs G2/i);
  assert.match(onDisk, /affiliation/i);
  assert.match(onDisk, /G2 API access 2026/);
  assert.match(onDisk, /Capterra data without a partnership/);
  assert.match(onDisk, /sr_live_/);
});

test("GET /.well-known/mcp/server-card.json lists shipped tools only", async () => {
  const { app } = await appWithKey();
  const response = await app.inject({
    method: "GET",
    url: "/.well-known/mcp/server-card.json",
  });
  assert.equal(response.statusCode, 200);
  const card = response.json() as { tools: string[]; transport: string };
  assert.equal(card.transport, "streamable-http");
  assert.deepEqual(card.tools, [
    GET_SAAS_TOOL,
    LIST_REVIEWS_TOOL,
    COMPARE_SAAS_TOOL,
  ]);
});

test("POST /mcp without bearer is 401 with 0 credits", async () => {
  const { app } = await appWithKey();
  const response = await rpc(app, "initialize", undefined, {});
  assert.equal(response.statusCode, 401);
  const body = response.json() as ErrBody;
  assert.equal(body.error.code, "unauthorized");
  assert.equal(body.meta.creditsCharged, 0);
});

test("initialize and tools/list describe get_saas, list_reviews, and compare_saas", async () => {
  const { app } = await appWithKey();

  const init = await rpc(app, "initialize");
  assert.equal(init.statusCode, 200);
  const initResult = (init.json() as JsonRpcOk).result as {
    protocolVersion: string;
    capabilities: { tools: unknown };
    serverInfo: { name: string };
    instructions: string;
  };
  assert.equal(initResult.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.equal(initResult.serverInfo.name, "saasreviews");
  assert.ok(initResult.capabilities.tools);
  assert.match(initResult.instructions, /public/i);
  assert.match(initResult.instructions, /not complete vs G2/i);
  assert.match(initResult.instructions, /affiliation/i);
  assert.match(initResult.instructions, /never invent a star/i);

  const listed = await rpc(app, "tools/list");
  assert.equal(listed.statusCode, 200);
  const tools = (
    (listed.json() as JsonRpcOk).result as {
      tools: Array<{ name: string }>;
    }
  ).tools.map((tool) => tool.name);
  assert.deepEqual(tools, [
    GET_SAAS_TOOL,
    LIST_REVIEWS_TOOL,
    COMPARE_SAAS_TOOL,
  ]);
});

test("MCP get_saas url matches REST by-url and charges 1 (SPEC 1)", async () => {
  const { app, db, key } = await appWithKey(10);

  const rest = await app.inject({
    method: "GET",
    url: `/v1/products/by-url?url=${encodeURIComponent(NOTION_G2_URL)}`,
    headers: auth(),
  });
  assert.equal(rest.statusCode, 200);
  const restBody = rest.json() as OkBody<ProductCard>;
  assert.equal(productCardSchema.safeParse(restBody.data).success, true);
  assert.equal(restBody.data.product.name, "Notion");
  assert.equal(typeof restBody.data.scores.overall, "number");
  assert.equal(restBody.meta.creditsCharged, 1);
  assert.equal(getCredits(db, key.id), 9);

  const mcp = await callTool(app, GET_SAAS_TOOL, { url: NOTION_G2_URL });
  assert.equal(mcp.isError, false);
  const mcpBody = mcp.structuredContent as OkBody<ProductCard>;
  assert.deepEqual(mcpBody.data, restBody.data);
  assert.equal(mcpBody.meta.creditsCharged, 1);
  assert.equal(mcpBody.meta.cached, true);
  assert.equal(mcpBody.meta.upstreamMs, 0);
  assert.match(mcpBody.meta.requestId, /^req_/);
  assert.equal(getCredits(db, key.id), 8);

  const parsedText = JSON.parse(mcp.content[0]?.text ?? "null") as OkBody<ProductCard>;
  assert.deepEqual(parsedText.data, restBody.data);
});

test("MCP get_saas Capterra url uses the same card schema with max 5 (SPEC 2)", async () => {
  const { app } = await appWithKey();
  const mcp = await callTool(app, GET_SAAS_TOOL, { url: NOTION_CAPTERRA_URL });
  assert.equal(mcp.isError, false);
  const body = mcp.structuredContent as OkBody<ProductCard>;
  assert.equal(productCardSchema.safeParse(body.data).success, true);
  assert.equal(body.data.product.directory, "capterra");
  assert.equal(body.data.product.id, "sr_prod_capterra_notion");
  assert.equal(body.data.scores.max, 5);
  assert.equal(typeof body.data.scores.overall, "number");
  assert.equal(body.meta.creditsCharged, 1);
});

test("MCP get_saas id argument resolves through core product lookup", async () => {
  const { app } = await appWithKey();
  const mcp = await callTool(app, GET_SAAS_TOOL, { id: "sr_prod_g2_slack" });
  assert.equal(mcp.isError, false);
  const body = mcp.structuredContent as OkBody<ProductCard>;
  assert.equal(body.data.product.id, "sr_prod_g2_slack");
  assert.equal(body.data.product.name, "Slack");
  assert.equal(body.meta.creditsCharged, 1);
});

test("MCP get_saas missing overall stays null, never 0 (SPEC 6)", async () => {
  const { app } = await appWithKey();
  const mcp = await callTool(app, GET_SAAS_TOOL, {
    url: "https://www.g2.com/products/ghostwriter/reviews",
  });
  assert.equal(mcp.isError, false);
  const body = mcp.structuredContent as OkBody<ProductCard>;
  assert.equal(body.data.scores.overall, null);
  assert.notEqual(body.data.scores.overall, 0);
  assert.equal(body.meta.creditsCharged, 1);
});

test("MCP get_saas errors match REST and charge 0", async () => {
  const { app, db, key } = await appWithKey(4);

  const missing = await callTool(app, GET_SAAS_TOOL, {});
  assert.equal(missing.isError, true);
  assert.equal((missing.structuredContent as ErrBody).error.code, "invalid_request");
  assert.equal((missing.structuredContent as ErrBody).meta.creditsCharged, 0);

  const unknown = await callTool(app, GET_SAAS_TOOL, {
    url: "https://www.g2.com/products/not-a-real-saas/reviews",
  });
  assert.equal((unknown.structuredContent as ErrBody).error.code, "product_not_found");
  assert.equal((unknown.structuredContent as ErrBody).meta.creditsCharged, 0);

  const unsupported = await callTool(app, GET_SAAS_TOOL, {
    url: "https://www.trustradius.com/products/slack",
  });
  assert.equal(
    (unsupported.structuredContent as ErrBody).error.code,
    "directory_unsupported",
  );

  const badId = await callTool(app, GET_SAAS_TOOL, { id: "not-an-id" });
  assert.equal((badId.structuredContent as ErrBody).error.code, "product_not_found");
  assert.equal(getCredits(db, key.id), 4);

  const empty = await appWithKey(0);
  const unpaid = await callTool(empty.app, GET_SAAS_TOOL, { url: NOTION_G2_URL });
  assert.equal((unpaid.structuredContent as ErrBody).error.code, "payment_required");
  assert.equal((unpaid.structuredContent as ErrBody).meta.creditsCharged, 0);
});

test("MCP list_reviews returns the same public page as REST (SPEC 3)", async () => {
  const { app, db, key } = await appWithKey(10);

  const rest = await app.inject({
    method: "GET",
    url: "/v1/products/sr_prod_g2_notion/reviews",
    headers: auth(),
  });
  assert.equal(rest.statusCode, 200);
  const restBody = rest.json() as OkBody<ReviewPage>;
  assert.equal(reviewPageSchema.safeParse(restBody.data).success, true);
  assert.ok(restBody.data.reviews.length >= 1);
  for (const review of restBody.data.reviews) {
    assert.ok(review.body.length > 0);
    assert.equal(review.body.includes("login"), false);
  }
  assert.equal(restBody.meta.creditsCharged, 1);
  assert.equal(getCredits(db, key.id), 9);

  const mcp = await callTool(app, LIST_REVIEWS_TOOL, { id: "sr_prod_g2_notion" });
  assert.equal(mcp.isError, false);
  const mcpBody = mcp.structuredContent as OkBody<ReviewPage>;
  assert.deepEqual(mcpBody.data, restBody.data);
  assert.equal(mcpBody.meta.creditsCharged, 1);
  assert.equal(mcpBody.meta.cached, true);
  assert.equal(getCredits(db, key.id), 8);
});

test("MCP list_reviews empty page is empty, not invented", async () => {
  const { app } = await appWithKey();
  const empty = await callTool(app, LIST_REVIEWS_TOOL, {
    id: "sr_prod_g2_ghostwriter",
  });
  assert.equal(empty.isError, false);
  const emptyBody = empty.structuredContent as OkBody<ReviewPage>;
  assert.deepEqual(emptyBody.data.reviews, []);
  assert.equal(emptyBody.data.hasMore, false);
  assert.equal(emptyBody.meta.creditsCharged, 1);
});

test("MCP list_reviews errors charge 0", async () => {
  const { app, db, key } = await appWithKey(3);
  const badPage = await callTool(app, LIST_REVIEWS_TOOL, {
    id: "sr_prod_g2_notion",
    page: 0,
  });
  assert.equal((badPage.structuredContent as ErrBody).error.code, "invalid_request");
  assert.equal((badPage.structuredContent as ErrBody).meta.creditsCharged, 0);

  const missing = await callTool(app, LIST_REVIEWS_TOOL, {
    id: "sr_prod_g2_not-a-real-saas",
  });
  assert.equal((missing.structuredContent as ErrBody).error.code, "product_not_found");
  assert.equal(getCredits(db, key.id), 3);
});

test("MCP compare_saas of two known products charges 2 (SPEC 4)", async () => {
  const { app, db, key } = await appWithKey(20);

  const rest = await app.inject({
    method: "GET",
    url: "/v1/compare?a=sr_prod_g2_notion&b=sr_prod_g2_slack",
    headers: auth(),
  });
  assert.equal(rest.statusCode, 200);
  const restBody = rest.json() as OkBody<CompareResult>;
  assert.equal(compareResultSchema.safeParse(restBody.data).success, true);
  assert.equal(restBody.data.a.product.name, "Notion");
  assert.equal(restBody.data.b.product.name, "Slack");
  assert.equal(restBody.meta.creditsCharged, 2);
  assert.equal(getCredits(db, key.id), 18);

  const mcp = await callTool(app, COMPARE_SAAS_TOOL, {
    a: "sr_prod_g2_notion",
    b: "sr_prod_g2_slack",
  });
  assert.equal(mcp.isError, false);
  const mcpBody = mcp.structuredContent as OkBody<CompareResult>;
  assert.deepEqual(mcpBody.data, restBody.data);
  assert.equal(mcpBody.data.scoreDelta, 0.2);
  assert.equal(mcpBody.meta.creditsCharged, 2);
  assert.equal(mcpBody.meta.cached, true);
  assert.equal(getCredits(db, key.id), 16);
});

test("MCP compare_saas unmatched names return both cards and warning (SPEC 5)", async () => {
  const { app, db, key } = await appWithKey(10);
  const mcp = await callTool(app, COMPARE_SAAS_TOOL, {
    a: "sr_prod_g2_ghostwriter",
    b: "sr_prod_capterra_ghostnote",
  });
  assert.equal(mcp.isError, false);
  const body = mcp.structuredContent as OkBody<CompareResult>;
  assert.equal(body.data.a.product.name, "Ghostwriter Labs");
  assert.equal(body.data.b.product.name, "Ghostnote Labs");
  assert.equal(body.data.a.scores.overall, null);
  assert.equal(body.data.b.scores.overall, null);
  assert.equal(body.data.scoreDelta, null);
  assert.equal(body.data.warning, "unmatched");
  assert.deepEqual(body.data.a.sameAs, []);
  assert.deepEqual(body.data.b.sameAs, []);
  assert.equal(body.meta.creditsCharged, 2);
  assert.equal(getCredits(db, key.id), 8);
});

test("MCP compare_saas via directory:slug still charges 2", async () => {
  const { app } = await appWithKey();
  const mcp = await callTool(app, COMPARE_SAAS_TOOL, {
    a: "g2:notion",
    b: "capterra:slack",
  });
  assert.equal(mcp.isError, false);
  const body = mcp.structuredContent as OkBody<CompareResult>;
  assert.equal(body.data.a.product.directory, "g2");
  assert.equal(body.data.b.product.directory, "capterra");
  assert.equal(body.data.warning, "unmatched");
  assert.equal(body.meta.creditsCharged, 2);
});

test("MCP compare_saas errors charge 0", async () => {
  const { app, db, key } = await appWithKey(6);
  const missing = await callTool(app, COMPARE_SAAS_TOOL, {
    a: "sr_prod_g2_notion",
    b: "sr_prod_g2_not-a-real-saas",
  });
  assert.equal((missing.structuredContent as ErrBody).error.code, "product_not_found");
  assert.equal((missing.structuredContent as ErrBody).meta.creditsCharged, 0);

  const unsupported = await callTool(app, COMPARE_SAAS_TOOL, {
    a: "sr_prod_g2_notion",
    b: "trustradius:slack",
  });
  assert.equal(
    (unsupported.structuredContent as ErrBody).error.code,
    "directory_unsupported",
  );
  assert.equal(getCredits(db, key.id), 6);
});

test("unknown MCP tool is invalid_request with 0 credits", async () => {
  const { app, db, key } = await appWithKey(5);
  const result = await callTool(app, "not_a_tool", { url: NOTION_G2_URL });
  assert.equal(result.isError, true);
  const body = result.structuredContent as ErrBody;
  assert.equal(body.error.code, "invalid_request");
  assert.equal(body.meta.creditsCharged, 0);
  assert.equal(getCredits(db, key.id), 5);
});

test("HTTP and MCP call core only and never value-import adapters", () => {
  const files = [
    ...walkTs(join(ROOT, "src/http")),
    ...walkTs(join(ROOT, "src/mcp")),
  ];
  assert.ok(files.length > 0);
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (file.endsWith("fastify.d.ts")) {
      continue;
    }
    for (const line of src.split("\n")) {
      if (!line.includes("adapters/")) {
        continue;
      }
      assert.match(line, /import type/, file);
    }
    assert.doesNotMatch(src, /\bfetch\s*\(/, file);
    assert.doesNotMatch(src, /\baxios\b/, file);
    assert.doesNotMatch(src, /\bgot\s*\(/, file);
  }
  const tools = readFileSync(join(ROOT, "src/mcp/tools.ts"), "utf8");
  assert.match(tools, /getProductByUrl/);
  assert.match(tools, /getProductReviews/);
  assert.match(tools, /compareProducts/);
  assert.match(tools, /get_saas/);
  assert.match(tools, /list_reviews/);
  assert.match(tools, /compare_saas/);
});

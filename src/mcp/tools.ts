import type { AdapterLookup } from "../adapters/index.js";
import type { Key } from "../billing/keys.js";
import { compareProducts } from "../core/compare.js";
import { getProductByUrl } from "../core/product.js";
import { getProductReviews } from "../core/reviews.js";
import { canonicalProductUrl, parseProductId } from "../core/url.js";
import type { SaasReviewsDb } from "../db.js";
import { isRetryable } from "../http/envelope.js";
import { isProductId, type Err, type ErrorCode, type Ok } from "../types.js";

export const GET_SAAS_TOOL = "get_saas" as const;
export const LIST_REVIEWS_TOOL = "list_reviews" as const;
export const COMPARE_SAAS_TOOL = "compare_saas" as const;

export const MCP_TOOL_NAMES = [
  GET_SAAS_TOOL,
  LIST_REVIEWS_TOOL,
  COMPARE_SAAS_TOOL,
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export type McpToolDefinition = {
  name: McpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolOutcome = Ok<unknown> | Err;

export type CallMcpToolInput = {
  name: string;
  args: Record<string, unknown>;
  db: SaasReviewsDb;
  adapters: AdapterLookup;
  key: Key;
  requestId?: string;
};

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: GET_SAAS_TOOL,
    description:
      "Public G2 or Capterra product card. Maps to GET /v1/products/by-url. " +
      "1 credit on success, including cache hits. Failures charge 0. " +
      "Never invent a star rating — missing overall is null, not 0. " +
      "Public reviews only; not complete vs G2's sold dataset; " +
      "do not imply affiliation with G2 or Capterra.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: {
          type: "string",
          description:
            "G2 or Capterra product URL (one of url or id required)",
        },
        id: {
          type: "string",
          description:
            "sr_prod_{directory}_{slug} product id (one of url or id required)",
        },
      },
    },
  },
  {
    name: LIST_REVIEWS_TOOL,
    description:
      "One page of public G2 or Capterra reviews. Maps to " +
      "GET /v1/products/{id}/reviews. 1 credit per page, including empty " +
      "pages and cache hits. Never invent a review. page is 1-based. " +
      "Public text only; not complete vs G2's sold dataset.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: {
        id: {
          type: "string",
          description: "sr_prod_{directory}_{slug} product id",
        },
        page: {
          type: "integer",
          minimum: 1,
          description: "1-based review page (default 1)",
        },
      },
    },
  },
  {
    name: COMPARE_SAAS_TOOL,
    description:
      "Side-by-side public scores for two products. Maps to GET /v1/compare. " +
      "2 credits when both lookups succeed, including unmatched pairs. " +
      "scoreDelta only if both overalls are numbers. Unmatched names return " +
      "both cards and warning unmatched — never a fake merge. " +
      "Do not imply affiliation with G2 or Capterra.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["a", "b"],
      properties: {
        a: {
          type: "string",
          description: "Product id, directory:slug, or G2/Capterra URL",
        },
        b: {
          type: "string",
          description: "Product id, directory:slug, or G2/Capterra URL",
        },
      },
    },
  },
];

export function isMcpToolName(name: string): name is McpToolName {
  return (MCP_TOOL_NAMES as readonly string[]).includes(name);
}

/** Dispatch an MCP tool to core/* only. */
export async function callMcpTool(
  input: CallMcpToolInput,
): Promise<McpToolOutcome> {
  if (!isMcpToolName(input.name)) {
    return fail(
      "invalid_request",
      input.requestId,
      `Unknown MCP tool '${input.name}'.`,
    );
  }

  switch (input.name) {
    case GET_SAAS_TOOL:
      return dispatchGetSaas(input);
    case LIST_REVIEWS_TOOL:
      return getProductReviews({
        db: input.db,
        adapters: input.adapters,
        key: input.key,
        requestId: input.requestId,
        productId: readStringArg(input.args, "id") ?? "",
        page: readPageArg(input.args, "page"),
      });
    case COMPARE_SAAS_TOOL:
      return compareProducts({
        db: input.db,
        adapters: input.adapters,
        key: input.key,
        requestId: input.requestId,
        a: readStringArg(input.args, "a"),
        b: readStringArg(input.args, "b"),
      });
  }
}

async function dispatchGetSaas(
  input: CallMcpToolInput,
): Promise<McpToolOutcome> {
  const url = readStringArg(input.args, "url");
  const id = readStringArg(input.args, "id");
  if (url === undefined && id === undefined) {
    return fail(
      "invalid_request",
      input.requestId,
      "Provide a url or id argument.",
    );
  }
  if (url !== undefined) {
    return getProductByUrl({
      db: input.db,
      adapters: input.adapters,
      key: input.key,
      requestId: input.requestId,
      url,
    });
  }

  const productId = id ?? "";
  if (!isProductId(productId)) {
    return fail(
      "product_not_found",
      input.requestId,
      "No public product matched that id.",
    );
  }
  const parsed = parseProductId(productId);
  if (parsed === null) {
    return fail(
      "product_not_found",
      input.requestId,
      "No public product matched that id.",
    );
  }
  return getProductByUrl({
    db: input.db,
    adapters: input.adapters,
    key: input.key,
    requestId: input.requestId,
    url: canonicalProductUrl(parsed.directory, parsed.directorySlug),
  });
}

function fail(
  code: ErrorCode,
  requestId: string | undefined,
  message: string,
): Err {
  return {
    error: {
      code,
      message,
      retryable: isRetryable(code),
    },
    meta: { creditsCharged: 0, requestId: requestId ?? "req_mcp_unknown_tool" },
  };
}

function readStringArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function readPageArg(
  args: Record<string, unknown>,
  key: string,
): string | number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

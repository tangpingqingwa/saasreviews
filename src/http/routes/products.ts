import type { FastifyPluginAsync } from "fastify";
import { getProductByUrl } from "../../core/product.js";
import { getProductReviews } from "../../core/reviews.js";
import { requireAuth } from "../auth.js";
import { sendErr, sendOk } from "../envelope.js";

export const PRODUCT_BY_URL_PATH = "/v1/products/by-url" as const;
export const PRODUCT_REVIEWS_PATH = "/v1/products/:id/reviews" as const;

type ByUrlQuery = {
  url?: string;
};

type ReviewsParams = {
  id: string;
};

type ReviewsQuery = {
  page?: string;
};

export const productRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ByUrlQuery }>(
    PRODUCT_BY_URL_PATH,
    { preHandler: requireAuth },
    async (request, reply) => {
      const key = request.apiKey;
      if (key === undefined) {
        return sendErr(reply, "internal", "Authenticated route missing key.");
      }
      const result = await getProductByUrl({
        db: request.server.db,
        adapters: request.server.adapters,
        key,
        url: request.query.url,
      });
      if ("error" in result) {
        return sendErr(
          reply,
          result.error.code,
          result.error.message,
          result.meta.requestId,
        );
      }
      return sendOk(reply, result.data, result.meta);
    },
  );

  app.get<{ Params: ReviewsParams; Querystring: ReviewsQuery }>(
    PRODUCT_REVIEWS_PATH,
    { preHandler: requireAuth },
    async (request, reply) => {
      const key = request.apiKey;
      if (key === undefined) {
        return sendErr(reply, "internal", "Authenticated route missing key.");
      }
      const result = await getProductReviews({
        db: request.server.db,
        adapters: request.server.adapters,
        key,
        productId: request.params.id,
        page: request.query.page,
      });
      if ("error" in result) {
        return sendErr(
          reply,
          result.error.code,
          result.error.message,
          result.meta.requestId,
        );
      }
      return sendOk(reply, result.data, result.meta);
    },
  );
};

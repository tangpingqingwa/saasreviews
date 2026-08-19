import type { FastifyPluginAsync } from "fastify";
import { listCategory } from "../../core/categories.js";
import { requireAuth } from "../auth.js";
import { sendErr, sendOk } from "../envelope.js";

export const CATEGORY_PATH = "/v1/categories/:slug" as const;

type CategoryParams = {
  slug: string;
};

type CategoryQuery = {
  directory?: string;
  page?: string;
};

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: CategoryParams; Querystring: CategoryQuery }>(
    CATEGORY_PATH,
    { preHandler: requireAuth },
    async (request, reply) => {
      const key = request.apiKey;
      if (key === undefined) {
        return sendErr(reply, "internal", "Authenticated route missing key.");
      }
      const result = await listCategory({
        db: request.server.db,
        adapters: request.server.adapters,
        key,
        slug: request.params.slug,
        directory: request.query.directory,
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

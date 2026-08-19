import type { FastifyPluginAsync } from "fastify";
import { compareProducts } from "../../core/compare.js";
import { requireAuth } from "../auth.js";
import { sendErr, sendOk } from "../envelope.js";

export const COMPARE_PATH = "/v1/compare" as const;

type CompareQuery = {
  a?: string;
  b?: string;
};

export const compareRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: CompareQuery }>(
    COMPARE_PATH,
    { preHandler: requireAuth },
    async (request, reply) => {
      const key = request.apiKey;
      if (key === undefined) {
        return sendErr(reply, "internal", "Authenticated route missing key.");
      }
      const result = await compareProducts({
        db: request.server.db,
        adapters: request.server.adapters,
        key,
        a: request.query.a,
        b: request.query.b,
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

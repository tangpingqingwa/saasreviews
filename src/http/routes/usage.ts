import type { FastifyPluginAsync } from "fastify";
import { defaultUsageWindow, listUsageDays, parseUsageDay } from "../../billing/usage.js";
import { usageQuerySchema } from "../../types.js";
import { requireAuth } from "../auth.js";
import { sendErr, sendOk } from "../envelope.js";

export const USAGE_PATH = "/v1/usage" as const;

export const usageRoutes: FastifyPluginAsync = async (app) => {
  app.get(USAGE_PATH, { preHandler: requireAuth }, async (request, reply) => {
    const key = request.apiKey;
    if (key === undefined) {
      return sendErr(reply, "internal", "Authenticated route missing key.");
    }

    const parsed = usageQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendErr(reply, "invalid_request", "from and to must be YYYY-MM-DD.");
    }
    const fallback = defaultUsageWindow();
    const from =
      parsed.data.from === undefined || parsed.data.from === ""
        ? fallback.from
        : parseUsageDay(parsed.data.from);
    const to =
      parsed.data.to === undefined || parsed.data.to === ""
        ? fallback.to
        : parseUsageDay(parsed.data.to);

    if (from === null || to === null) {
      return sendErr(reply, "invalid_request", "from and to must be YYYY-MM-DD.");
    }
    if (from > to) {
      return sendErr(reply, "invalid_request", "from must be on or before to.");
    }

    return sendOk(reply, listUsageDays(request.server.db, key.id, from, to), {
      cached: false,
      creditsCharged: 0,
      upstreamMs: 0,
    });
  });
};

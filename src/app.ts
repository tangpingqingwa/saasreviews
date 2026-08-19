import Fastify, { type FastifyInstance } from "fastify";
import { createAppAdapters, type AdapterLookup } from "./adapters/index.js";
import { bootstrapKeyIfEmpty } from "./billing/keys.js";
import { openDatabase, type SaasReviewsDb } from "./db.js";
import { healthRoutes } from "./http/routes/health.js";
import { meRoutes } from "./http/routes/me.js";
import { productRoutes } from "./http/routes/products.js";
import { usageRoutes } from "./http/routes/usage.js";

export type BuildAppOptions = {
  logger?: boolean;
  db?: SaasReviewsDb;
  databasePath?: string;
  bootstrapKey?: string;
  adapters?: AdapterLookup;
};

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const ownsDb = options.db === undefined;
  const db = options.db ?? openDatabase(options.databasePath ?? ":memory:");
  if (options.bootstrapKey !== undefined) {
    bootstrapKeyIfEmpty(db, options.bootstrapKey);
  }
  app.decorate("db", db);
  app.decorate("adapters", options.adapters ?? createAppAdapters());
  app.decorateRequest("apiKey", undefined);
  if (ownsDb) {
    app.addHook("onClose", async (instance) => {
      instance.db.close();
    });
  }
  await app.register(healthRoutes);
  await app.register(meRoutes);
  await app.register(usageRoutes);
  await app.register(productRoutes);
  return app;
}

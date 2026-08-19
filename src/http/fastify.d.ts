import type { AdapterLookup } from "../adapters/index.js";
import type { Key } from "../billing/keys.js";
import type { SaasReviewsDb } from "../db.js";

declare module "fastify" {
  interface FastifyInstance {
    db: SaasReviewsDb;
    adapters: AdapterLookup;
  }

  interface FastifyRequest {
    apiKey?: Key;
  }
}

export {};

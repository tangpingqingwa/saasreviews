import type { DirectoryAdapter } from "../adapters/types.js";
import type { Key } from "../billing/keys.js";
import type { SaasReviewsDb } from "../db.js";

declare module "fastify" {
  interface FastifyInstance {
    db: SaasReviewsDb;
    adapter: DirectoryAdapter;
  }

  interface FastifyRequest {
    apiKey?: Key;
  }
}

export {};

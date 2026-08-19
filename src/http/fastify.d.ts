import type { Key } from "../billing/keys.js";
import type { SaasReviewsDb } from "../db.js";

declare module "fastify" {
  interface FastifyInstance {
    db: SaasReviewsDb;
  }

  interface FastifyRequest {
    apiKey?: Key;
  }
}

export {};

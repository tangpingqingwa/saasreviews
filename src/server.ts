import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({
  logger: true,
  databasePath: config.databasePath,
  bootstrapKey: config.bootstrapKey,
});
if (config.adapterMode === "live") {
  app.log.warn(
    "SAASREVIEWS_LIVE_DIRECTORIES=1: fetching public G2/Capterra HTML. Default remains fixtures.",
  );
}
await app.listen({ host: "0.0.0.0", port: config.port });

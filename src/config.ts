const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_PATH = "./data/saasreviews.sqlite";

export const DEFAULT_FREE_CREDITS = 100;
export const DEFAULT_FREE_RPM = 30;

export type AdapterMode = "fixture" | "live";

export type AppConfig = {
  port: number;
  databasePath: string;
  bootstrapKey: string | undefined;
  nodeEnv: string;
  adapterMode: AdapterMode;
};

export function parseListenPort(value = process.env.PORT): number {
  if (value === undefined || value === "") {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer 1-65535, got ${JSON.stringify(value)}`);
  }
  return port;
}

/** Live G2/Capterra adapters stay off unless this env is an explicit "1". */
export function parseAdapterMode(env: NodeJS.ProcessEnv = process.env): AdapterMode {
  if (truthyEnv(env.SAASREVIEWS_FIXTURE_ONLY)) {
    return "fixture";
  }
  if (truthyEnv(env.SAASREVIEWS_LIVE_DIRECTORIES)) {
    return "live";
  }
  return "fixture";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const databasePath = env.SAASREVIEWS_DATABASE;
  if ((databasePath === undefined || databasePath === "") && nodeEnv === "production") {
    throw new Error("SAASREVIEWS_DATABASE is required in production");
  }
  const bootstrapKey = env.SAASREVIEWS_BOOTSTRAP_KEY;
  return {
    port: parseListenPort(env.PORT),
    databasePath:
      databasePath !== undefined && databasePath !== ""
        ? databasePath
        : DEFAULT_DATABASE_PATH,
    bootstrapKey:
      bootstrapKey !== undefined && bootstrapKey !== "" ? bootstrapKey : undefined,
    nodeEnv,
    adapterMode: parseAdapterMode(env),
  };
}

function truthyEnv(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

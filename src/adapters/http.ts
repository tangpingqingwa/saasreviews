import type { AdapterFailureCode } from "./types.js";

export const DEFAULT_USER_AGENT =
  "SaaSReviews/0.1 (+https://github.com/tangpingqingwa/saasreviews; public reviews only)";

export const DEFAULT_TIMEOUT_MS = 8_000;

export type DirectoryHttpResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
};

export type DirectoryFetch = (url: string) => Promise<DirectoryHttpResponse>;

export type DirectoryFetchOptions = {
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
};

export function createDirectoryFetch(
  options: DirectoryFetchOptions = {},
): DirectoryFetch {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.8",
          "user-agent": userAgent,
        },
      });
      return {
        status: response.status,
        body: await response.text(),
        headers: headerRecord(response.headers),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

export function mapHttpFailure(
  status: number,
  body: string,
): AdapterFailureCode | null {
  if (status === 404 || status === 410) {
    return "product_not_found";
  }
  if (status === 401 || status === 403 || status === 429 || status >= 500) {
    return "upstream_blocked";
  }
  if (status >= 400) {
    return "upstream_blocked";
  }
  if (looksLikeBotWall(body)) {
    return "upstream_blocked";
  }
  return null;
}

export function looksLikeBotWall(body: string): boolean {
  const sample = body.slice(0, 8_000).toLowerCase();
  if (sample.includes("captcha") && sample.includes("cloudflare")) {
    return true;
  }
  if (sample.includes("cf-browser-verification")) {
    return true;
  }
  if (sample.includes("access denied") && sample.includes("cloudflare")) {
    return true;
  }
  if (sample.includes("please enable javascript and cookies")) {
    return true;
  }
  if (sample.includes("unusual traffic") && sample.includes("verify you are a human")) {
    return true;
  }
  return false;
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

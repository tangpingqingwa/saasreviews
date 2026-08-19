import type { Directory, ErrorCode } from "../types.js";

export type ParsedDirectoryUrl =
  | { ok: true; directory: Directory; directorySlug: string; url: string }
  | {
      ok: false;
      code: Extract<ErrorCode, "invalid_request" | "directory_unsupported">;
      message: string;
    };

const G2_HOSTS = new Set(["g2.com", "www.g2.com"]);

const KNOWN_UNSUPPORTED_HOSTS = new Set([
  "capterra.com",
  "www.capterra.com",
  "trustradius.com",
  "www.trustradius.com",
  "gartner.com",
  "www.gartner.com",
]);

export function parseProductUrl(raw: string | undefined): ParsedDirectoryUrl {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed === "") {
    return {
      ok: false,
      code: "invalid_request",
      message: "Provide a url query parameter.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(hasScheme(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return {
      ok: false,
      code: "invalid_request",
      message: "url is not a valid URL.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      code: "invalid_request",
      message: "url is not a valid URL.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (G2_HOSTS.has(host)) {
    const slug = g2SlugFromPath(parsed.pathname);
    if (slug === null) {
      return {
        ok: false,
        code: "invalid_request",
        message: "url is not a G2 product URL.",
      };
    }
    return {
      ok: true,
      directory: "g2",
      directorySlug: slug,
      url: canonicalG2Url(slug),
    };
  }

  if (KNOWN_UNSUPPORTED_HOSTS.has(host)) {
    return {
      ok: false,
      code: "directory_unsupported",
      message: "Only G2 product URLs are supported in this milestone.",
    };
  }

  return {
    ok: false,
    code: "directory_unsupported",
    message: "Directory is not g2 or capterra.",
  };
}

export function canonicalG2Url(slug: string): string {
  return `https://www.g2.com/products/${slug}/reviews`;
}

export function g2SlugFromPath(pathname: string): string | null {
  const match = /^\/products\/([^/]+)(?:\/(?:reviews|pricing|features)?)?\/?$/.exec(
    pathname,
  );
  if (match?.[1] === undefined || match[1] === "") {
    return null;
  }
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return null;
  }
}

function hasScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

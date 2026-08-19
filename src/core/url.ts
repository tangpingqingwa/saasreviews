import { parseDirectory, type Directory, type ErrorCode } from "../types.js";

export type ParsedDirectoryUrl =
  | { ok: true; directory: Directory; directorySlug: string; url: string }
  | {
      ok: false;
      code: Extract<ErrorCode, "invalid_request" | "directory_unsupported">;
      message: string;
    };

const G2_HOSTS = new Set(["g2.com", "www.g2.com"]);
const CAPTERRA_HOSTS = new Set(["capterra.com", "www.capterra.com"]);

const KNOWN_UNSUPPORTED_HOSTS = new Set([
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

  if (CAPTERRA_HOSTS.has(host)) {
    const slug = capterraSlugFromPath(parsed.pathname);
    if (slug === null) {
      return {
        ok: false,
        code: "invalid_request",
        message: "url is not a Capterra product URL.",
      };
    }
    return {
      ok: true,
      directory: "capterra",
      directorySlug: slug,
      url: canonicalCapterraUrl(slug),
    };
  }

  if (KNOWN_UNSUPPORTED_HOSTS.has(host)) {
    return {
      ok: false,
      code: "directory_unsupported",
      message: "Directory is not g2 or capterra.",
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

export function canonicalCapterraUrl(slug: string): string {
  return `https://www.capterra.com/p/${slug}/`;
}

export function g2SlugFromPath(pathname: string): string | null {
  const match = /^\/products\/([^/]+)(?:\/(?:reviews|pricing|features)?)?\/?$/.exec(
    pathname,
  );
  return decodeSlug(match?.[1]);
}

/**
 * Capterra public product pages are `/p/{id}/{slug}/` or `/p/{slug}/`.
 * Numeric software ids are dropped so fixtures key on the slug.
 */
export function capterraSlugFromPath(pathname: string): string | null {
  const numbered = /^\/p\/\d+\/([^/]+)(?:\/(?:reviews)?)?\/?$/.exec(pathname);
  if (numbered) {
    return decodeSlug(numbered[1]);
  }
  const slugged = /^\/p\/([^/]+)(?:\/(?:reviews)?)?\/?$/.exec(pathname);
  if (slugged) {
    const first = slugged[1];
    if (first !== undefined && /^\d+$/.test(first)) {
      return null;
    }
    return decodeSlug(first);
  }
  return null;
}

export function productIdFor(directory: Directory, slug: string): string {
  return `sr_prod_${directory}_${slug}`;
}

export function canonicalProductUrl(directory: Directory, slug: string): string {
  return directory === "g2" ? canonicalG2Url(slug) : canonicalCapterraUrl(slug);
}

export function parseRequiredDirectory(
  value: string | undefined,
):
  | { ok: true; value: Directory }
  | {
      ok: false;
      code: Extract<ErrorCode, "invalid_request" | "directory_unsupported">;
      message: string;
    } {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    return {
      ok: false,
      code: "invalid_request",
      message: "Provide directory=g2 or directory=capterra.",
    };
  }
  const directory = parseDirectory(trimmed);
  if (directory === null) {
    return {
      ok: false,
      code: "directory_unsupported",
      message: "Directory is not g2 or capterra.",
    };
  }
  return { ok: true, value: directory };
}

export function parseProductId(
  productId: string,
): { directory: Directory; directorySlug: string } | null {
  const match = /^sr_prod_(g2|capterra)_(.+)$/.exec(productId);
  const directory = match?.[1];
  const directorySlug = match?.[2];
  if (directory !== "g2" && directory !== "capterra") {
    return null;
  }
  if (directorySlug === undefined || directorySlug === "") {
    return null;
  }
  return { directory, directorySlug };
}

function decodeSlug(value: string | undefined): string | null {
  if (value === undefined || value === "") {
    return null;
  }
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return null;
  }
}

function hasScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

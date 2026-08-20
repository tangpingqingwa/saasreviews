import { parseDirectory, type Directory, type ErrorCode } from "../types.js";

export type ParsedDirectoryUrl =
  | { ok: true; directory: Directory; directorySlug: string; url: string }
  | {
      ok: false;
      code: Extract<ErrorCode, "invalid_request" | "directory_unsupported">;
      message: string;
    };

const G2_HOSTS = new Set(["g2.com", "www.g2.com"]);

/** Public Capterra locales that sometimes serve product HTML when .com is walled. */
export const CAPTERRA_PUBLIC_HOSTS = [
  "www.capterra.com",
  "www.capterra.ca",
  "www.capterra.com.au",
  "www.capterra.in",
  "www.capterra.co.uk",
  "www.capterra.ie",
] as const;

const CAPTERRA_HOSTS = new Set(
  CAPTERRA_PUBLIC_HOSTS.flatMap((host) => {
    const bare = host.replace(/^www\./, "");
    return [host, bare];
  }),
);

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

export function g2ReviewsRssUrl(slug: string, page = 1): string {
  const base = `https://www.g2.com/products/${encodeURIComponent(slug)}/reviews.rss`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

/**
 * Candidate public Capterra product URLs for a slug.
 * `.com /p/{slug}` first (SPEC canonical). Regional `/software/{id}/{slug}`
 * pages are the same Capterra product when `.com` is a bot wall.
 */
export function capterraPublicProductUrls(
  slug: string,
  requestedUrl?: string,
): string[] {
  const urls: string[] = [];
  const push = (url: string) => {
    if (!urls.includes(url)) {
      urls.push(url);
    }
  };
  if (requestedUrl !== undefined && requestedUrl !== "") {
    push(requestedUrl);
  }
  push(canonicalCapterraUrl(slug));
  const numericId =
    numericIdFromCapterraUrl(requestedUrl) ?? publicCapterraSoftwareId(slug);
  if (numericId !== null) {
    push(`https://www.capterra.com/p/${numericId}/${encodeURIComponent(slug)}/`);
    for (const host of CAPTERRA_PUBLIC_HOSTS) {
      if (host === "www.capterra.com") {
        continue;
      }
      push(`https://${host}/software/${numericId}/${encodeURIComponent(slug)}`);
    }
  }
  return urls;
}

/**
 * Regional Capterra `/software/{id}/{slug}` ids. Used only to build public
 * fallback URLs. Scores still come from the fetched page.
 */
const CAPTERRA_PUBLIC_SOFTWARE_IDS: Record<string, string> = {
  notion: "186596",
  slack: "135003",
  jira: "19319",
};

export function publicCapterraSoftwareId(slug: string): string | null {
  return CAPTERRA_PUBLIC_SOFTWARE_IDS[slug.toLowerCase()] ?? null;
}

export function numericIdFromCapterraUrl(raw: string | undefined): string | null {
  if (raw === undefined || raw === "") {
    return null;
  }
  try {
    const parsed = new URL(hasScheme(raw) ? raw : `https://${raw}`);
    const numbered = /^\/(?:p|software)\/(\d+)\/[^/]+/i.exec(parsed.pathname);
    return numbered?.[1] ?? null;
  } catch {
    return null;
  }
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
  const numbered = /^\/(?:p|software)\/\d+\/([^/]+)(?:\/(?:reviews)?)?\/?$/.exec(
    pathname,
  );
  if (numbered) {
    return decodeSlug(numbered[1]);
  }
  const slugged = /^\/(?:p|software)\/([^/]+)(?:\/(?:reviews)?)?\/?$/.exec(pathname);
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

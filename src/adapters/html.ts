/** Tiny HTML helpers. Live adapters parse public pages only; no login walls. */

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    });
}

export function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function firstMatch(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  const value = match?.[1];
  if (value === undefined) {
    return null;
  }
  const trimmed = decodeHtmlEntities(value).trim();
  return trimmed === "" ? null : trimmed;
}

export function parseJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (raw === undefined || raw === "") {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        blocks.push(...parsed);
      } else {
        blocks.push(parsed);
      }
    } catch {
      // Public pages sometimes emit trailing commas; skip that block.
    }
  }
  return blocks;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function jsonLdType(value: unknown): string[] {
  const record = asRecord(value);
  if (record === null) {
    return [];
  }
  const raw = record["@type"];
  if (typeof raw === "string") {
    return [raw.toLowerCase()];
  }
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === "string").map((item) =>
      item.toLowerCase(),
    );
  }
  return [];
}

export function walkJsonLd(nodes: unknown[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const next = stack.pop();
    if (Array.isArray(next)) {
      stack.push(...next);
      continue;
    }
    const record = asRecord(next);
    if (record === null) {
      continue;
    }
    out.push(record);
    const graph = record["@graph"];
    if (Array.isArray(graph)) {
      stack.push(...graph);
    }
  }
  return out;
}

export function textFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = decodeHtmlEntities(value).replace(/\s+/g, " ").trim();
    return trimmed === "" ? null : trimmed;
  }
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  return textFromUnknown(record.name ?? record.value ?? record.text);
}

export function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (match === null) {
      return null;
    }
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  return numberFromUnknown(record.ratingValue ?? record.value ?? record.worstRating);
}

export function isoFromUnknown(value: unknown): string | null {
  const text = textFromUnknown(value);
  if (text === null) {
    return null;
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) {
    return text;
  }
  return new Date(parsed).toISOString();
}

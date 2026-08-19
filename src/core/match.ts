import type { ProductCard, ProductRef } from "../types.js";

export const MATCH_THRESHOLD = 0.9;

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function registrableDomain(url: string | undefined): string | null {
  if (url === undefined || url === "") {
    return null;
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    const labels = host.split(".").filter((part) => part.length > 0);
    if (labels.length < 2) {
      return null;
    }
    return labels.slice(-2).join(".");
  } catch {
    return null;
  }
}

export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (left === "" || right === "") {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  const longer = left.length >= right.length ? left : right;
  const shorter = left.length >= right.length ? right : left;
  const distance = levenshtein(left, right);
  return 1 - distance / longer.length - (longer.includes(shorter) ? 0 : 0.05);
}

export function matchScore(a: ProductCard, b: ProductCard): number {
  const nameScore = nameSimilarity(a.product.name, b.product.name);
  const domainA = vendorDomain(a.product.url);
  const domainB = vendorDomain(b.product.url);
  if (domainA !== null && domainB !== null && domainA === domainB) {
    return Math.min(1, Math.max(nameScore, 0.9));
  }
  return nameScore;
}

export function productsLinked(a: ProductCard, b: ProductCard): boolean {
  if (a.product.id === b.product.id) {
    return true;
  }
  if (a.sameAs.some((ref) => ref.id === b.product.id)) {
    return true;
  }
  if (b.sameAs.some((ref) => ref.id === a.product.id)) {
    return true;
  }
  if (normalizeName(a.product.name) === normalizeName(b.product.name)) {
    return true;
  }
  const domainA = vendorDomain(a.product.url);
  const domainB = vendorDomain(b.product.url);
  if (domainA === null || domainB === null || domainA !== domainB) {
    return false;
  }
  return matchScore(a, b) >= MATCH_THRESHOLD;
}

export function linkSameAs(a: ProductCard, b: ProductCard): [ProductCard, ProductCard] {
  if (!productsLinked(a, b) || a.product.id === b.product.id) {
    return [
      { ...a, sameAs: [] },
      { ...b, sameAs: [] },
    ];
  }
  return [
    { ...a, sameAs: withRef(a.sameAs, a.product, b.product) },
    { ...b, sameAs: withRef(b.sameAs, b.product, a.product) },
  ];
}

function withRef(existing: ProductRef[], self: ProductRef, other: ProductRef): ProductRef[] {
  const next = existing.filter((ref) => ref.id !== self.id && ref.id !== other.id);
  next.push(other);
  return next;
}

function vendorDomain(url: string): string | null {
  const domain = registrableDomain(url);
  if (domain === null || domain === "g2.com" || domain === "capterra.com") {
    return null;
  }
  return domain;
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i += 1) {
    grid[i]![0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    grid[0]![j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i]![j] = Math.min(
        (grid[i - 1]![j] ?? 0) + 1,
        (grid[i]![j - 1] ?? 0) + 1,
        (grid[i - 1]![j - 1] ?? 0) + cost,
      );
    }
  }
  return grid[a.length]![b.length] ?? 0;
}

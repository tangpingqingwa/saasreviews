import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DIRECTORIES,
  isDirectory,
  isProductId,
  parseDirectory,
  PRODUCT_ID_PREFIX,
  productCardSchema,
  productRefSchema,
  productScoresSchema,
  reviewPageSchema,
  type ProductCard,
  type ProductRef,
  type ProductScores,
} from "../src/types.js";

test("ProductRef matches SPEC: id, directory g2|capterra, slug, url, name", () => {
  const g2: ProductRef = {
    id: "sr_prod_notion",
    directory: "g2",
    directorySlug: "notion",
    url: "https://www.g2.com/products/notion/reviews",
    name: "Notion",
  };
  const capterra: ProductRef = {
    id: "sr_prod_obsidian",
    directory: "capterra",
    directorySlug: "obsidian",
    url: "https://www.capterra.com/p/obsidian",
    name: "Obsidian",
  };

  assert.deepEqual(Object.keys(g2).sort(), [
    "directory",
    "directorySlug",
    "id",
    "name",
    "url",
  ]);
  assert.equal(g2.directory, "g2");
  assert.equal(capterra.directory, "capterra");
  assert.equal(isProductId(g2.id), true);
  assert.equal(g2.id.startsWith(PRODUCT_ID_PREFIX), true);
  assert.equal(isProductId("prod_missing_prefix"), false);
  assert.equal(isProductId("sr_prod_"), false);
  assert.equal(productRefSchema.safeParse(g2).success, true);
  assert.equal(productRefSchema.safeParse(capterra).success, true);
  assert.equal(
    productRefSchema.safeParse({ ...g2, directory: "trustradius" }).success,
    false,
  );
  assert.equal(productRefSchema.safeParse({ ...g2, id: "prod_x" }).success, false);
});

test("directory enum is g2 | capterra only", () => {
  assert.deepEqual([...DIRECTORIES], ["g2", "capterra"]);
  assert.equal(isDirectory("g2"), true);
  assert.equal(isDirectory("capterra"), true);
  assert.equal(isDirectory("trustradius"), false);
  assert.equal(parseDirectory("G2"), "g2");
  assert.equal(parseDirectory("Capterra"), "capterra");
  assert.equal(parseDirectory("gartner"), null);
  assert.equal(parseDirectory(""), null);
  assert.equal(parseDirectory(undefined), null);
});

test("missing overall score is null, never 0", () => {
  const missing: ProductScores = {
    overall: null,
    max: 5,
    reviewCount: null,
  };
  assert.equal(missing.overall, null);
  assert.notEqual(missing.overall, 0);
  assert.equal(missing.max, 5);
  assert.equal(productScoresSchema.safeParse(missing).success, true);
  assert.equal(
    productScoresSchema.safeParse({ overall: "missing", max: 5, reviewCount: null })
      .success,
    false,
  );
});

test("product card and review page match SPEC 5.1 / 5.2", () => {
  const card: ProductCard = {
    product: {
      id: "sr_prod_g2_notion",
      directory: "g2",
      directorySlug: "notion",
      url: "https://www.g2.com/products/notion/reviews",
      name: "Notion",
    },
    sameAs: [],
    scores: { overall: 4.7, max: 5, reviewCount: 10 },
    pricingTeaser: "Free plan available",
    categories: ["Knowledge Base"],
    extractedAt: "2026-01-15T12:00:00.000Z",
  };
  assert.equal(productCardSchema.safeParse(card).success, true);
  assert.equal(
    reviewPageSchema.safeParse({
      page: 1,
      hasMore: false,
      reviews: [
        {
          id: "g2_notion_r1",
          title: "Useful wiki",
          body: "Public review body.",
          stars: 5,
          createdAt: "2025-11-02T00:00:00.000Z",
          reviewerTitle: "PM",
          industry: "Software",
          companySize: "51-200",
          validated: true,
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    reviewPageSchema.safeParse({
      page: 1,
      hasMore: false,
      reviews: [{ id: null, title: null, body: "", stars: null }],
    }).success,
    false,
  );
});

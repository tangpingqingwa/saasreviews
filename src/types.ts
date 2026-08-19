import { z } from "zod";

export const directorySchema = z.enum(["g2", "capterra"]);

export const keyPrefixSchema = z.enum(["sr_live", "sr_test"]);

export const planSchema = z.enum(["free", "monthly", "annual"]);

export const productIdSchema = z
  .string()
  .regex(/^sr_prod_.+$/, "product id must start with sr_prod_");

export const productRefSchema = z.object({
  id: productIdSchema,
  directory: directorySchema,
  directorySlug: z.string().min(1),
  url: z.string().url(),
  name: z.string().min(1),
});

export const productScoresSchema = z.object({
  overall: z.number().nullable(),
  max: z.number(),
  reviewCount: z.number().int().nullable(),
});

export const usageDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  credits: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
});

export const usageQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export type Directory = z.infer<typeof directorySchema>;
export type KeyPrefix = z.infer<typeof keyPrefixSchema>;
export type Plan = z.infer<typeof planSchema>;
export type ProductRef = z.infer<typeof productRefSchema>;
export type ProductScores = z.infer<typeof productScoresSchema>;
export type UsageDay = z.infer<typeof usageDaySchema>;

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "payment_required"
  | "product_not_found"
  | "directory_unsupported"
  | "unmatched_compare"
  | "rate_limited"
  | "upstream_blocked"
  | "internal";

export const DIRECTORIES: readonly Directory[] = directorySchema.options;

export const KEY_PREFIXES: readonly KeyPrefix[] = keyPrefixSchema.options;

export const ERROR_CODES: readonly ErrorCode[] = [
  "invalid_request",
  "unauthorized",
  "payment_required",
  "product_not_found",
  "directory_unsupported",
  "unmatched_compare",
  "rate_limited",
  "upstream_blocked",
  "internal",
];

export const PRODUCT_ID_PREFIX = "sr_prod_" as const;

export type Ok<T> = {
  data: T;
  meta: {
    cached: boolean;
    creditsCharged: number;
    requestId: string;
    upstreamMs: number;
  };
};

export type Err = {
  error: { code: ErrorCode; message: string; retryable: boolean };
  meta: { creditsCharged: 0; requestId: string };
};

export type UsageData = {
  from: string;
  to: string;
  days: UsageDay[];
};

export function isDirectory(value: string): value is Directory {
  return directorySchema.safeParse(value).success;
}

export function isProductId(value: string): boolean {
  return productIdSchema.safeParse(value).success;
}

export function parseDirectory(value: string | undefined): Directory | null {
  if (value === undefined || value === "") {
    return null;
  }
  const parsed = directorySchema.safeParse(value.toLowerCase());
  return parsed.success ? parsed.data : null;
}

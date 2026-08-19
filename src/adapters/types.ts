import type { Directory, ProductCard, ReviewPage } from "../types.js";

export type AdapterProductRequest = {
  directory: Directory;
  directorySlug: string;
  url: string;
};

export type AdapterReviewsRequest = {
  directory: Directory;
  directorySlug: string;
  page: number;
};

export type AdapterFailureCode =
  | "product_not_found"
  | "directory_unsupported"
  | "upstream_blocked";

export type AdapterProductOk = {
  ok: true;
  card: ProductCard;
};

export type AdapterReviewsOk = {
  ok: true;
  page: ReviewPage;
};

export type AdapterErr = {
  ok: false;
  code: AdapterFailureCode;
};

export type AdapterProductResult = AdapterProductOk | AdapterErr;
export type AdapterReviewsResult = AdapterReviewsOk | AdapterErr;

export type DirectoryAdapter = {
  directory: Directory;
  fetchProduct(request: AdapterProductRequest): Promise<AdapterProductResult>;
  fetchReviews(request: AdapterReviewsRequest): Promise<AdapterReviewsResult>;
  listProducts(): ProductCard[];
};

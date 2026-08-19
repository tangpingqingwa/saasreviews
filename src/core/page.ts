export const DEFAULT_PAGE_SIZE = 10;

export function parsePositivePage(value: string | number | undefined): number | null {
  if (value === undefined || value === "") {
    return 1;
  }
  const page = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(page) || page < 1) {
    return null;
  }
  return page;
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): { page: number; hasMore: boolean; items: T[] } {
  const start = (page - 1) * pageSize;
  return {
    page,
    hasMore: start + pageSize < items.length,
    items: items.slice(start, start + pageSize),
  };
}

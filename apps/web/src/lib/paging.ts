export const API_PAGE = 1000;

type Page<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Reads every row of a query. The API returns at most 1,000 rows a request, so anything that must
 * be complete (an export) reads page after page instead of stopping at the first.
 */
export async function everyRow<T>(page: (from: number, to: number) => PromiseLike<Page<T>>, size = API_PAGE): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < size) return rows;
  }
}

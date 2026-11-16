import { useTablePage, type TablePageQuery } from "./useTablePage";

/** Complete small inventories/summaries; raw reports and history use pages. */
export function useCompleteTable<TData>(name: string, query: Omit<TablePageQuery, "page" | "loadAll"> = {}) {
  return useTablePage<TData>(name, { ...query, loadAll: true });
}

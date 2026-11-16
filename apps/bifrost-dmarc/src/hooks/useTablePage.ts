import { useCallback, useEffect, useRef, useState } from "react";
import { tables } from "bifrost";

const EMPTY_ROWS: never[] = [];

export interface TablePageQuery {
  where?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
  order_by?: string;
  order_dir?: "asc" | "desc";
  enabled?: boolean;
  /** Only small inventories and daily summaries may exhaust their query. */
  loadAll?: boolean;
  /** Latest-status widgets do not need a full-table count. */
  skipCount?: boolean;
}

/** A server-filtered page. Live events refresh the page instead of growing it. */
export function useTablePage<TData>(name: string, query: TablePageQuery = {}) {
  const { enabled = true, loadAll = false, skipCount = false, order_by, order_dir } = query;
  const pageSize = Math.min(1000, Math.max(1, Math.trunc(query.pageSize ?? 50)));
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const whereKey = JSON.stringify(query.where ?? null);
  const key = JSON.stringify([name, whereKey, page, pageSize, order_by, order_dir, enabled, loadAll, skipCount]);
  const [snapshot, setSnapshot] = useState<{
    key: string; rows: TData[]; total: number; loading: boolean; error: Error | null;
  }>({ key: "", rows: [], total: 0, loading: true, error: null });
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let active = true;
    let inFlight: Promise<void> | null = null;
    let dirty = false;
    let revoked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const where = JSON.parse(whereKey) as Record<string, unknown> | undefined;

    const scheduleRefresh = () => {
      // Coalesce ingestion bursts without starting parallel reads.
      if (!active || revoked || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void read();
      }, 400);
    };
    const read = (): Promise<void> => {
      if (!active || !enabled || revoked) return Promise.resolve();
      if (inFlight) {
        dirty = true;
        return inFlight;
      }
      inFlight = (async () => {
        do {
          dirty = false;
          setSnapshot((previous) => ({
            key, rows: previous.key === key ? previous.rows : [],
            total: previous.key === key ? previous.total : 0, loading: true, error: null,
          }));
          try {
            const rows: TData[] = [];
            let total = 0;
            let offset = loadAll ? 0 : (page - 1) * pageSize;
            do {
              const result = await tables.query(name, {
                where: where ?? undefined, limit: pageSize, offset, order_by, order_dir,
                skip_count: skipCount || (loadAll && offset > 0) ? true : undefined,
              });
              if (!active || revoked) return;
              if (!unsubscribe) {
                // HTTP owns filtering so contains queries also work. The
                // server still enforces row policies on the subscription.
                unsubscribe = tables.subscribe(result.table_id, null, (event) => {
                  if (!active) return;
                  if (event.type === "error" || event.type === "subscription_revoked") {
                    revoked = true;
                    if (timer) clearTimeout(timer);
                    timer = undefined;
                    setSnapshot({ key, rows: [], total: 0, loading: false,
                      error: new Error(event.type === "error" ? event.message : "Access to this table was revoked.") });
                    return;
                  }
                  scheduleRefresh();
                }, scheduleRefresh);
              }
              if (!rows.length) total = result.total;
              rows.push(...result.documents.map((document) => ({ ...document.data, id: document.id }) as TData));
              offset += result.documents.length;
              if (!loadAll || result.documents.length < pageSize || (total >= 0 && offset >= total)) break;
            } while (active);
            if (active && !revoked) setSnapshot({ key,
              rows: [...new Map(rows.map((row) => [String((row as { id: string }).id), row])).values()],
              total, loading: false, error: null });
          } catch (error) {
            if (active && !revoked) setSnapshot({ key, rows: [], total: 0, loading: false,
              error: error instanceof Error ? error : new Error(String(error)) });
          }
        } while (dirty && active && !revoked);
      })().finally(() => { inFlight = null; });
      return inFlight;
    };

    refreshRef.current = async () => {
      if (revoked) {
        revoked = false;
        unsubscribe?.();
        unsubscribe = undefined;
      }
      await read();
    };
    void read();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
      refreshRef.current = async () => {};
    };
  }, [key, name, whereKey, enabled, loadAll, skipCount, page, pageSize, order_by, order_dir]);

  const current = enabled && snapshot.key === key;
  return {
    rows: current ? snapshot.rows : EMPTY_ROWS,
    total: current ? snapshot.total : 0,
    loading: enabled && (!current || snapshot.loading),
    error: current ? snapshot.error : null,
    refresh,
  };
}

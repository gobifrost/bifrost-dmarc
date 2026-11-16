import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tables } from "bifrost";
import { useTablePage } from "./useTablePage";

vi.mock("bifrost", () => ({ tables: { query: vi.fn(), subscribe: vi.fn() } }));
const page = (id: string, total = 5000) => ({ table_id: "reports-id", total, documents: [{ id, data: { domain: `${id}.example` } }] });
let onEvent: (event: { type: string; message?: string }) => void;
let onReconnect: () => void;
let unsubscribe: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.clearAllMocks();
  unsubscribe = vi.fn();
  vi.mocked(tables.subscribe).mockImplementation((_id, _filter, event, reconnect) => {
    onEvent = event; onReconnect = reconnect!; return unsubscribe;
  });
  vi.mocked(tables.query).mockResolvedValue(page("first"));
});
afterEach(() => vi.useRealTimers());

describe("useTablePage", () => {
  it("reads one bounded server-filtered page even when thousands remain", async () => {
    const where = { domain: "example.com", date: { gte: "2026-11-01" } };
    const { result } = renderHook(() => useTablePage("reports", { where, page: 3, pageSize: 50, order_by: "date", order_dir: "desc" }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(tables.query).toHaveBeenCalledExactlyOnceWith("reports", expect.objectContaining({ where, offset: 100, limit: 50, order_by: "date", order_dir: "desc" }));
    expect(result.current.total).toBe(5000);
    expect(result.current.rows).toEqual([{ id: "first", domain: "first.example" }]);
  });

  it("never queries or subscribes while disabled and cleans up when leaving", async () => {
    const { result, rerender } = renderHook(({ enabled }) => useTablePage("reports", { enabled }), { initialProps: { enabled: false } });
    expect(tables.query).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    rerender({ enabled: false });
    expect(result.current.rows).toEqual([]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("discards a delayed response after the filter changes", async () => {
    let finishOld!: (value: ReturnType<typeof page>) => void;
    vi.mocked(tables.query).mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
    const { result, rerender } = renderHook(({ domain }) => useTablePage("reports", { where: { domain } }), { initialProps: { domain: "old.example" } });
    rerender({ domain: "new.example" });
    await waitFor(() => expect(result.current.rows).toEqual([{ id: "first", domain: "first.example" }]));
    await act(async () => finishOld(page("old")));
    expect(result.current.rows).toEqual([{ id: "first", domain: "first.example" }]);
    expect(tables.subscribe).toHaveBeenCalledOnce();
  });

  it("coalesces live bursts and reconnects into bounded current-page refreshes", async () => {
    const { result, unmount } = renderHook(() => useTablePage("reports", { pageSize: 50 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.useFakeTimers();
    act(() => { for (let i = 0; i < 100; i++) onEvent({ type: "document_change" }); onReconnect(); });
    expect(tables.query).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(tables.query).toHaveBeenCalledTimes(2);
    expect(tables.query).toHaveBeenLastCalledWith("reports", expect.objectContaining({ offset: 0, limit: 50 }));
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("shows query errors and retries without showing rows from another query", async () => {
    vi.mocked(tables.query).mockRejectedValueOnce(new Error("Access denied"));
    const { result } = renderHook(() => useTablePage("reports"));
    await waitFor(() => expect(result.current.error?.message).toBe("Access denied"));
    expect(result.current.rows).toEqual([]);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(result.current.rows).toHaveLength(1);
  });

  it("clears revoked rows and prevents an in-flight refresh from restoring them", async () => {
    const { result } = renderHook(() => useTablePage("reports"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let finishRefresh!: (value: ReturnType<typeof page>) => void;
    vi.mocked(tables.query).mockReturnValueOnce(new Promise((resolve) => { finishRefresh = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.refresh(); });
    act(() => { onEvent({ type: "subscription_revoked" }); });
    await act(async () => { finishRefresh(page("private")); await pending; });
    expect(result.current.rows).toEqual([]);
    expect(result.current.error?.message).toMatch(/revoked/);
  });
});

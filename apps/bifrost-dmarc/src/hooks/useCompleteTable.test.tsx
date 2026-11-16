import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tables } from "bifrost";
import { useCompleteTable } from "./useCompleteTable";

vi.mock("bifrost", () => ({ tables: { query: vi.fn(), subscribe: vi.fn(() => vi.fn()) } }));

beforeEach(() => vi.clearAllMocks());

describe("useCompleteTable", () => {
  it("loads every daily summary page while counting only once", async () => {
    vi.mocked(tables.query)
      .mockResolvedValueOnce({ table_id: "daily", total: 3, documents: [{ id: "a", data: { total: 10 } }, { id: "b", data: { total: 20 } }] })
      .mockResolvedValueOnce({ table_id: "daily", total: -1, documents: [{ id: "c", data: { total: 30 } }] });
    const { result } = renderHook(() => useCompleteTable("daily", { pageSize: 2 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(3);
    expect(tables.query).toHaveBeenNthCalledWith(2, "daily", expect.objectContaining({ offset: 2, limit: 2, skip_count: true }));
  });
  it("does not read inventories belonging to another route", () => {
    renderHook(() => useCompleteTable("sources", { enabled: false }));
    expect(tables.query).not.toHaveBeenCalled();
    expect(tables.subscribe).not.toHaveBeenCalled();
  });
});

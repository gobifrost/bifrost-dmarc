import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BfDataTable } from "./BfDataTable";

describe("BfDataTable server sorting", () => {
  it("preserves server order and forwards sort changes instead of sorting display labels", async () => {
    const onSortChange = vi.fn();
    render(<BfDataTable rows={[{ id: "new", date: "Nov 1, 2026" }, { id: "old", date: "Oct 31, 2026" }]}
      columns={[{ id: "date", header: "Date", accessor: "date", sortable: true }]}
      getRowId={(row) => row.id} manualSorting sort={{ columnId: "date", direction: "descending" }} onSortChange={onSortChange} />);
    const body = screen.getAllByRole("rowgroup")[1];
    expect(within(body).getAllByRole("row").map((row) => row.textContent)).toEqual(["Nov 1, 2026", "Oct 31, 2026"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Date" }));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: "date", direction: "ascending" });
  });
});

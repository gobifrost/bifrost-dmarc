import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AggregateReport, DashboardData, FailureRecord } from "../types";

const mocks = vi.hoisted(() => ({ useTablePage: vi.fn(), get: vi.fn() }));
vi.mock("../hooks/useTablePage", () => ({ useTablePage: mocks.useTablePage }));
vi.mock("bifrost", () => ({ tables: { get: mocks.get } }));
import { ReportsPage } from "./ReportsPage";

const report: AggregateReport = { id: "report-key-1", reporter: "Google", domain: "example.com", organization_name: "Example Organization", date_end: "2026-08-13T00:00:00Z", message_count: 6000, record_count: 1 };
const record: FailureRecord = { id: "record-1", report_key: "report-key-1", date: "2026-08-13", domain: "example.com", organization_name: "Example Organization", source_ip: "192.0.2.1", count: 13, sending_source: "Forwarder", disposition: "none", dkim: "fail", spf: "fail", classification: "forwarded", header_from: "example.com", envelope_from: "bounce.sender.example", envelope_to: "recipient.example" };
const data: DashboardData = { summary: { messages: 6000, compliance: 99, protected: 1, domain_count: 1, unmapped: 0 }, trend: [], sources: [{ name: "Forwarder", messages: 13 }], attention: [], organizations: [], domains: [{ id: "domain-1", domain: "example.com", organization_id: "org-1", organization_name: "Example Organization", mapping_status: "mapped", mapping_source: "manual", dmarc_policy: "reject", dmarc_record: "", rua: "", has_dmarc: true, spf_status: "valid", spf_record: "", cached_at: "2026-08-13T00:00:00Z" }], reports: [], failures: [], ingest: null };

function page(rows: unknown[] = [], total = rows.length, overrides = {}) { return { rows, total, loading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined), ...overrides }; }
function setup({ reports = [report], records = [record], reportTotal = reports.length, failureTotal = records.length, error }: { reports?: AggregateReport[]; records?: FailureRecord[]; reportTotal?: number; failureTotal?: number; error?: Error } = {}) {
  mocks.get.mockResolvedValue({ id: report.id, data: { ...report, id: undefined } });
  mocks.useTablePage.mockImplementation((name: string, query: { enabled?: boolean; where?: Record<string, unknown> }) => {
    if (!query.enabled) return page();
    if (name === "dmarc_reports") return page(reports, reportTotal, error ? { error } : {});
    if (name === "dmarc_records") return page(records, query.where?.report_key ? records.length : failureTotal);
    return page();
  });
}
function calls(name: string) { return mocks.useTablePage.mock.calls.filter(([table]) => table === name); }
function lastEnabled(name: string) { const enabled = calls(name).map(([, query]) => query).filter((query) => query.enabled); return enabled[enabled.length - 1]; }

describe("ReportsPage", () => {
  beforeEach(() => { vi.clearAllMocks(); setup(); });

  it("queries only the active tab on mount", () => {
    render(<MemoryRouter><ReportsPage data={data} loading={false} /></MemoryRouter>);
    expect(lastEnabled("dmarc_reports")).toMatchObject({ page: 1, pageSize: 50, order_by: "date_end", order_dir: "desc" });
    expect(calls("dmarc_records").every(([, query]) => !query.enabled)).toBe(true);
    expect(calls("dmarc_ingest_events").every(([, query]) => !query.enabled)).toBe(true);
  });

  it("requests the selected tab with its server-side issue filter", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReportsPage data={data} loading={false} /></MemoryRouter>);
    await user.click(screen.getByRole("tab", { name: /Issues/ }));
    expect(lastEnabled("dmarc_records")).toMatchObject({ page: 1, pageSize: 50, where: expect.objectContaining({ classification: { ne: "compliant" } }) });
    expect(screen.getByText("192.0.2.1")).toBeInTheDocument();
  });

  it("requests the next server page and resets to page one when a filter changes", async () => {
    const user = userEvent.setup();
    setup({ reportTotal: 51 });
    render(<MemoryRouter><ReportsPage data={data} loading={false} /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Next Page" }));
    expect(lastEnabled("dmarc_reports")).toMatchObject({ page: 2 });
    await user.type(screen.getByLabelText("Search Domain"), "example");
    await waitFor(() => expect(lastEnabled("dmarc_reports")).toMatchObject({ page: 1 }));
  });

  it("keeps the requested page while its count and rows are loading", async () => {
    const user = userEvent.setup();
    let pending = true;
    mocks.useTablePage.mockImplementation((name: string, query: { enabled?: boolean; page?: number }) => {
      if (name !== "dmarc_reports" || !query.enabled) return page();
      return query.page === 2 && pending ? page([], 0, { loading: true }) : page([report], 51);
    });
    const { rerender } = render(<MemoryRouter><ReportsPage data={data} loading={false} /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Next Page" }));
    await waitFor(() => expect(lastEnabled("dmarc_reports")).toMatchObject({ page: 2 }));
    pending = false;
    rerender(<MemoryRouter><ReportsPage data={data} loading={false} /></MemoryRouter>);
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  });

  it("does not request retained records until a drawer opens, then pages by report_key", async () => {
    const user = userEvent.setup();
    const records = Array.from({ length: 26 }, (_, index) => ({ ...record, id: `record-${index + 1}`, source_ip: `192.0.2.${index + 1}` }));
    setup({ records });
    render(<MemoryRouter><ReportsPage data={data} loading={false} /></MemoryRouter>);
    expect(calls("dmarc_records").every(([, query]) => !query.enabled)).toBe(true);
    await user.click(screen.getByRole("row", { name: /example\.com.*Google/ }));
    await waitFor(() => expect(lastEnabled("dmarc_records")).toMatchObject({ where: { report_key: "report-key-1" }, page: 1, pageSize: 25 }));
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next Page" }));
    expect(lastEnabled("dmarc_records")).toMatchObject({ where: { report_key: "report-key-1" }, page: 2, pageSize: 25 });
  });

  it("renders query errors with retry", async () => {
    const user = userEvent.setup(); const refresh = vi.fn().mockResolvedValue(undefined);
    mocks.useTablePage.mockImplementation((name: string, query: { enabled?: boolean }) => name === "dmarc_reports" && query.enabled ? page([], 0, { error: new Error("offline"), refresh }) : page());
    render(<MemoryRouter><ReportsPage data={data} loading={false} /></MemoryRouter>);
    expect(screen.getByText("Could not load aggregate reports")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useTablePage } from "./hooks/useTablePage";
import { liveStartDate } from "./lib/liveDashboard";

const emptyRows: never[] = [];
vi.mock("./hooks/useTablePage", () => ({ useTablePage: vi.fn() }));
vi.mock("bifrost", () => ({
  tables: { update: vi.fn() },
  useWorkflowQuery: () => ({ data: { organizations: [], setup: {} }, loading: false }),
  useWorkflowMutation: () => ({ mutate: vi.fn(), loading: false }),
}));
vi.mock("./hooks/useWorkflowDispatch", () => ({ useWorkflowDispatch: () => ({ dispatch: vi.fn(), loading: false }) }));
vi.mock("./components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("./components/OverviewPage", () => ({ OverviewPage: (props: { onDaysChange: (days: number) => void; onOrganizationChange: (org: string) => void }) => <><button onClick={() => props.onDaysChange(14)}>14 Days</button><button onClick={() => props.onOrganizationChange("org-1")}>Choose Organization</button></> }));
vi.mock("./components/DomainsPage", () => ({ DomainsPage: () => null }));
vi.mock("./components/OrganizationsPage", () => ({ OrganizationsPage: () => null }));
vi.mock("./components/MigrationPage", () => ({ MigrationPage: () => null }));
vi.mock("./components/SettingsPage", () => ({ SettingsPage: () => null }));
vi.mock("./components/ReportsPage", () => ({ ReportsPage: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useTablePage).mockImplementation(() => ({ rows: emptyRows, total: 0, loading: false, error: null, refresh: vi.fn() }));
});
const activeCalls = () => vi.mocked(useTablePage).mock.calls.filter(([, options]) => options?.enabled !== false);

describe("App data loading", () => {
  it("opens the overview with summaries and one status row, without raw reports or history", () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(activeCalls().map(([table]) => table)).toEqual(["dmarc_domains", "dmarc_daily_metrics", "dmarc_ingest_events"]);
    expect(activeCalls().find(([table]) => table === "dmarc_daily_metrics")?.[1]).toMatchObject({ where: { date: { gte: liveStartDate(30) } } });
    expect(activeCalls().find(([table]) => table === "dmarc_ingest_events")?.[1]).toMatchObject({ pageSize: 1, skipCount: true });
  });

  it("applies overview range and organization to the server summary query", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><App /></MemoryRouter>);
    await user.click(screen.getByText("14 Days"));
    await user.click(screen.getByText("Choose Organization"));
    const calls = activeCalls().filter(([table]) => table === "dmarc_daily_metrics");
    expect(calls[calls.length - 1]?.[1]).toMatchObject({ where: { date: { gte: liveStartDate(14) }, organization_id: "org-1" } });
    expect(activeCalls().some(([table]) => table === "dmarc_reports" || table === "dmarc_records")).toBe(false);
  });

  it("defers settings and migration reads to their routes", () => {
    const settings = render(<MemoryRouter initialEntries={["/settings"]}><App /></MemoryRouter>);
    expect(activeCalls().map(([table]) => table)).toEqual(["dmarc_domains", "dmarc_ingest_events", "dmarc_investigations", "dmarc_dns_changes"]);
    settings.unmount();
    vi.mocked(useTablePage).mockClear();
    render(<MemoryRouter initialEntries={["/migration"]}><App /></MemoryRouter>);
    expect(activeCalls().map(([table]) => table)).toEqual(["dmarc_domains", "dmarc_spf_sources", "dmarc_daily_metrics", "dmarc_ingest_events", "dmarc_migration_runs"]);
  });
});

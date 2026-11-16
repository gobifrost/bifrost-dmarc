import { AlertTriangle, Check, Download, ExternalLink, Inbox, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { tables } from "bifrost";

import { useTablePage } from "../hooks/useTablePage";
import { formatDate, formatNumber } from "../lib/format";
import { buildReportQuery, type ReportTab } from "../lib/reportQueries";
import type { AggregateReport, DashboardData, FailureRecord, IngestStatus } from "../types";
import { BfActionMenu } from "./bifrost/BfActionMenu";
import { BfButton } from "./bifrost/BfButton";
import { BfCombobox, BfMultiSelect, type BfComboboxOption } from "./bifrost/BfCombobox";
import { BfChip } from "./bifrost/BfChip";
import { BfDataTable, BfPagination, type BfDataColumn, type BfDataTableSort } from "./bifrost/BfDataTable";
import { BfTextField } from "./bifrost/BfField";
import { BfTabs } from "./bifrost/BfTabs";
import { Drawer } from "./Drawer";

const PAGE_SIZE = 50;
const DETAIL_PAGE_SIZE = 25;
const fields: Record<ReportTab, BfComboboxOption[]> = {
  aggregate: [{ value: "domain", label: "Domain" }, { value: "organization_name", label: "Organization" }, { value: "reporter", label: "Reporter" }, { value: "report_id", label: "Report ID" }],
  failures: [{ value: "domain", label: "Domain" }, { value: "organization_name", label: "Organization" }, { value: "sending_source", label: "Sending source" }, { value: "source_ip", label: "Source IP" }, { value: "header_from", label: "Header From" }, { value: "envelope_from", label: "Envelope From" }, { value: "envelope_to", label: "Envelope To" }],
  inbound: [{ value: "route", label: "Route" }, { value: "status", label: "Status" }, { value: "error", label: "Error" }, { value: "ignore_reason", label: "Ignore reason" }],
};
const initialSort: Record<ReportTab, BfDataTableSort> = {
  aggregate: { columnId: "date", direction: "descending" }, failures: { columnId: "date", direction: "descending" }, inbound: { columnId: "completed", direction: "descending" },
};
const sortFields: Record<ReportTab, Record<string, string>> = {
  aggregate: { organization: "organization_name", domain: "domain", reporter: "reporter", date: "date_end", messages: "message_count" },
  failures: { organization: "organization_name", domain: "domain", date: "date", source: "sending_source", ip: "source_ip", messages: "count", issue: "classification" },
  inbound: { status: "status", route: "route", reports: "report_count", messages: "message_count", completed: "completed_at" },
};

function reportedValue(value: string | undefined, fallback: string) { return !value || value.trim().toLowerCase().startsWith("unknown") ? fallback : value; }
function dateDays(value: string | null) { if (!value) return 30; const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 90) : 30; }
function errorState(title: string, error: Error | null, refresh: () => Promise<void>) { return error ? { title, description: error.message, onRetry: refresh } : undefined; }

function useReportByKey(reportKey: string | undefined, enabled: boolean) {
  const [state, setState] = useState<{ key: string; report?: AggregateReport; loading: boolean; error: Error | null }>({ key: "", loading: false, error: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !reportKey) { setState({ key: "", loading: false, error: null }); return; }
    let active = true;
    setState({ key: reportKey, loading: true, error: null });
    void tables.get("dmarc_reports", reportKey).then((document) => {
      if (active) setState({ key: reportKey, report: document ? { ...document.data, id: document.id } as AggregateReport : undefined, loading: false, error: null });
    }).catch((error: unknown) => {
      if (active) setState({ key: reportKey, loading: false, error: error instanceof Error ? error : new Error(String(error)) });
    });
    return () => { active = false; };
  }, [enabled, reportKey, retry]);
  const current = enabled && state.key === reportKey;
  return { report: current ? state.report : undefined, loading: enabled && (!current || state.loading), error: current ? state.error : null, refresh: () => setRetry((value) => value + 1) };
}

function ReportToolbar({ search, field, options, filters, onSearch, onField, onClear, onExport }: {
  search: string; field: string; options: BfComboboxOption[]; filters: Array<{ key: string; label: string }>;
  onSearch: (value: string) => void; onField: (value: string) => void; onClear: (key: string) => void; onExport: () => void;
}) {
  const label = options.find((option) => option.value === field)?.label ?? "selected field";
  return <><BfCombobox className="data-toolbar-filter" label="Search Field" value={field} options={options} searchable={false} onValueChange={onField} />
    <BfTextField className="data-toolbar-search" label={`Search ${label}`} value={search} onChange={(event) => onSearch(event.target.value)} leadingIcon={<Search size={15} />} placeholder={`Contains ${label.toLowerCase()}`} />
    {filters.map((filter) => <BfButton key={filter.key} variant="ghost" trailingIcon={<X size={14} />} onClick={() => onClear(filter.key)}>{filter.label}</BfButton>)}
    <BfButton variant="secondary" icon={<Download size={14} />} onClick={onExport}>Export Page CSV</BfButton></>;
}

function DomainIdentifiers({ record }: { record: FailureRecord }) {
  const values = [{ label: "From", value: reportedValue(record.header_from || record.domain, "Not Reported") }, { label: "Mail From", value: reportedValue(record.envelope_from, "Not Reported") }, { label: "To", value: reportedValue(record.envelope_to, "Not Reported") }];
  return <div className="report-identifiers" aria-label="Message domains for result combination">{values.map(({ label, value }) => <span key={label} className={value === "Not Reported" ? "is-missing" : ""} aria-label={`${label}: ${value}`} title={`${label}: ${value}`}>{value === "Not Reported" ? "—" : value}</span>)}</div>;
}
function AuthenticationMark({ label, value }: { label: "DMARC" | "SPF" | "DKIM"; value: string }) {
  const pass = value === "pass"; const display = value ? `${value.charAt(0).toUpperCase()}${value.slice(1).replace(/_/g, " ")}` : "Not Reported";
  return <span className={`report-auth-mark ${pass ? "pass" : "fail"}`} aria-label={`${label}: ${display}`} title={`${label}: ${display}`}>{pass ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}</span>;
}

export function ReportsPage({ data, loading, coverageLoading = false }: { data?: DashboardData; loading: boolean; coverageLoading?: boolean }) {
  const [params, setParams] = useSearchParams();
  const requestedView = params.get("view");
  const requestedTab: ReportTab = requestedView === "failures" || requestedView === "inbound" ? requestedView : "aggregate";
  const [tab, setTab] = useState<ReportTab>(requestedTab);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [field, setField] = useState(fields[requestedTab][0].value);
  const [sort, setSort] = useState<BfDataTableSort>(initialSort[requestedTab]);
  const [sources, setSources] = useState<string[]>(params.get("source") ? [params.get("source")!] : []);
  const [selectedReport, setSelectedReport] = useState<AggregateReport>();
  const [selectedRecord, setSelectedRecord] = useState<FailureRecord>();
  const [selectedIngest, setSelectedIngest] = useState<IngestStatus>();
  const [detailPage, setDetailPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const domain = params.get("domain") ?? "";
  const exactDate = params.get("date") ?? "";
  const organizationId = params.get("organization") ?? "";
  const activeDomains = useMemo(() => (data?.domains ?? []).filter((item) => item.lifecycle_status !== "archived").map((item) => item.domain).filter(Boolean), [data?.domains]);
  const organizationName = data?.organizations.find((item) => item.id === organizationId)?.name ?? "";
  const expectedDomains = (data?.domains ?? []).filter((item) => item.reports_to_bifrost);
  const missingDomains = expectedDomains.filter((item) => item.reporting_status === "awaiting" || item.reporting_status === "stale");
  const inventoryReady = !loading;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (requestedView === "aggregate" || requestedView === "failures" || requestedView === "inbound") {
      setTab(requestedView); setField(fields[requestedView][0].value); setSort(initialSort[requestedView]); setPage(1);
    }
  }, [requestedView]);

  const queryKey = `${tab}|${params.toString()}|${sources.join("\u0001")}|${field}|${debouncedSearch}|${sort.columnId}|${sort.direction}`;
  const queryKeyRef = useRef(queryKey);
  const effectivePage = queryKeyRef.current === queryKey ? page : 1;
  useEffect(() => {
    if (queryKeyRef.current !== queryKey) { queryKeyRef.current = queryKey; setPage(1); }
  }, [queryKey]);
  const query = useMemo(() => buildReportQuery({ tab, days: dateDays(params.get("days")), organizationId, domain, activeDomains, exactDate, sources, searchField: field, search: debouncedSearch, page: effectivePage, orderBy: sortFields[tab][sort.columnId] ?? (tab === "inbound" ? "completed_at" : "date_end"), orderDir: sort.direction === "ascending" ? "asc" : "desc" }), [activeDomains, debouncedSearch, domain, effectivePage, exactDate, field, organizationId, params, sort, sources, tab]);
  const reports = useTablePage<AggregateReport>("dmarc_reports", { ...query, enabled: inventoryReady && tab === "aggregate" });
  const failures = useTablePage<FailureRecord>("dmarc_records", { ...query, enabled: inventoryReady && tab === "failures" });
  const inbound = useTablePage<IngestStatus>("dmarc_ingest_events", { ...query, enabled: inventoryReady && tab === "inbound" });
  const reportLookup = useReportByKey(selectedRecord?.report_key, inventoryReady && Boolean(selectedRecord?.report_key && !selectedReport));
  const report = selectedReport ?? reportLookup.report;
  const reportKey = selectedReport?.id ?? selectedRecord?.report_key;
  const detail = useTablePage<FailureRecord>("dmarc_records", { where: reportKey ? { report_key: reportKey } : undefined, page: detailPage, pageSize: DETAIL_PAGE_SIZE, order_by: "date", order_dir: "desc", enabled: inventoryReady && Boolean(reportKey) });
  const active = tab === "aggregate" ? reports : tab === "failures" ? failures : inbound;
  useEffect(() => {
    if (inventoryReady && !active.loading && !active.error) {
      setPage((current) => Math.min(current, Math.max(1, Math.ceil(active.total / PAGE_SIZE))));
    }
  }, [inventoryReady, active.total, active.loading, active.error]);
  useEffect(() => {
    if (reportKey && !detail.loading && !detail.error) {
      setDetailPage((current) => Math.min(current, Math.max(1, Math.ceil(detail.total / DETAIL_PAGE_SIZE))));
    }
  }, [reportKey, detail.total, detail.loading, detail.error]);
  const urlFilters = [...(domain ? [{ key: "domain", label: domain }] : []), ...(exactDate ? [{ key: "date", label: formatDate(exactDate) }] : []), ...(organizationId ? [{ key: "organization", label: organizationName || "Selected Organization" }] : [])];
  const visibleFilters = tab === "inbound" ? urlFilters.filter((filter) => filter.key === "date") : urlFilters;
  const sourceOptions = useMemo(() => Array.from(new Set([...sources, ...(data?.sources ?? []).map((source) => source.name), ...failures.rows.map((row) => row.sending_source)].filter(Boolean))).sort().map((value) => ({ value, label: value })), [data?.sources, failures.rows, sources]);
  const detailRows = reportKey ? detail.rows : selectedRecord ? [selectedRecord] : [];
  const detailTotal = reportKey ? detail.total : selectedRecord ? 1 : 0;
  const grouped = detailRows.reduce<Record<string, FailureRecord[]>>((result, row) => { const key = reportedValue(row.sending_source, "Unidentified Source"); (result[key] ??= []).push(row); return result; }, {});
  const detailSources = new Set(detailRows.map((row) => reportedValue(row.sending_source, "Unidentified Source"))).size;

  const resetPage = () => setPage(1);
  const changeTab = (value: string) => { const next = value as ReportTab; setTab(next); setField(fields[next][0].value); setSort(initialSort[next]); resetPage(); const nextParams = new URLSearchParams(params); nextParams.set("view", next); setParams(nextParams, { replace: true }); };
  const clearUrlFilter = (key: string) => { const next = new URLSearchParams(params); next.delete(key); setParams(next, { replace: true }); resetPage(); };
  const openReport = (value: AggregateReport) => { setSelectedReport(value); setSelectedRecord(undefined); setDetailPage(1); };
  const openFailure = (value: FailureRecord) => { setSelectedRecord(value); setSelectedReport(undefined); setDetailPage(1); };
  const changeSort = (value: BfDataTableSort) => { setSort(value); resetPage(); };
  const changeSearch = (value: string) => { setSearch(value); resetPage(); };
  const changeField = (value: string) => { setField(value); resetPage(); };
  const changeSources = (value: string[]) => { setSources(value); resetPage(); };
  const closeReport = () => { setSelectedReport(undefined); setSelectedRecord(undefined); setDetailPage(1); };
  const exportCsv = () => {
    const rows = tab === "aggregate" ? [["Organization", "Domain", "Reporter", "Report date", "Messages"], ...reports.rows.map((row) => [row.organization_name, row.domain, row.reporter, row.date_end, row.message_count])] : tab === "failures" ? [["Organization", "Domain", "Date", "Sending Source", "Source IP", "Header From Domain", "Envelope From Domain", "Envelope To Domain", "Messages", "Classification", "Disposition", "SPF", "DKIM"], ...failures.rows.map((row) => [row.organization_name, row.domain, row.date, row.sending_source, row.source_ip, row.header_from, row.envelope_from, row.envelope_to, row.count, row.classification, row.disposition, row.spf, row.dkim])] : [["Status", "Route", "Recipients", "Reports", "Messages", "Completed", "Error"], ...inbound.rows.map((row) => [row.status, row.route, row.recipients?.join("; "), row.report_count, row.message_count, row.completed_at, row.error || row.ignore_reason])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `bifrost-dmarc-${tab}-page.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  const aggregateColumns = useMemo<BfDataColumn<AggregateReport>[]>(() => [
    { id: "organization", header: "Organization", width: "24%", sortable: true, accessor: (row) => row.organization_name || "Unassigned" }, { id: "domain", header: "Domain", width: "24%", sortable: true, accessor: (row) => <strong className="domain-name">{row.domain}</strong> }, { id: "reporter", header: "Reporter", width: "20%", sortable: true, accessor: "reporter" }, { id: "date", header: "Report Date", width: "20%", sortable: true, accessor: (row) => formatDate(row.date_end) }, { id: "messages", header: "Messages", width: "12%", align: "end", accessor: (row) => <strong>{formatNumber(row.message_count)}</strong> }, { id: "actions", header: <span className="sr-only">Actions</span>, width: "2.75rem", align: "end", cell: (row) => <BfActionMenu label={`Actions for ${row.domain} report`} items={[{ value: "open", label: "Open Report", icon: <ExternalLink size={14} /> }]} onSelect={() => openReport(row)} /> },
  ], []);
  const failureColumns = useMemo<BfDataColumn<FailureRecord>[]>(() => [
    { id: "organization", header: "Organization", width: "16%", sortable: true, accessor: (row) => row.organization_name || "Unassigned" }, { id: "domain", header: "Domain", width: "16%", sortable: true, accessor: (row) => <strong className="domain-name">{row.domain}</strong> }, { id: "date", header: "Date", width: "11%", sortable: true, accessor: (row) => formatDate(row.date) }, { id: "source", header: "Sending Source", width: "15%", sortable: true, accessor: (row) => reportedValue(row.sending_source, "Not Reported") }, { id: "ip", header: "Source IP", width: "14%", sortable: true, accessor: (row) => <span className="mono">{reportedValue(row.source_ip, "Not Reported")}</span> }, { id: "messages", header: "Messages", width: "8%", align: "end", accessor: (row) => <strong>{formatNumber(row.count)}</strong> }, { id: "issue", header: "Issue", width: "10%", sortable: true, accessor: (row) => <BfChip tone={row.classification === "forwarded" ? "info" : "danger"}>{row.classification.replace("_", " ")}</BfChip> }, { id: "spf", header: "SPF", width: "5%", accessor: (row) => <BfChip tone={row.spf === "pass" ? "success" : "danger"}>{row.spf}</BfChip> }, { id: "dkim", header: "DKIM", width: "5%", accessor: (row) => <BfChip tone={row.dkim === "pass" ? "success" : "danger"}>{row.dkim}</BfChip> }, { id: "actions", header: <span className="sr-only">Actions</span>, width: "2.75rem", align: "end", cell: (row) => <BfActionMenu label={`Actions for ${row.domain} issue`} items={[{ value: "open", label: "Open Issue", icon: <ExternalLink size={14} /> }]} onSelect={() => openFailure(row)} /> },
  ], []);
  const inboundColumns = useMemo<BfDataColumn<IngestStatus>[]>(() => [
    { id: "status", header: "Status", width: "15%", sortable: true, accessor: (row) => <BfChip tone={row.status === "completed" ? "success" : row.status === "failed" ? "danger" : "info"}>{row.status}</BfChip> }, { id: "route", header: "Route", width: "18%", sortable: true, accessor: (row) => row.route || "—" }, { id: "recipients", header: "Recipients", width: "29%", accessor: (row) => row.recipients?.join(", ") || "—" }, { id: "reports", header: "Reports", width: "9%", align: "end", accessor: (row) => row.report_count ?? 0 }, { id: "messages", header: "Messages", width: "10%", align: "end", accessor: (row) => row.message_count ?? 0 }, { id: "completed", header: "Completed", width: "17%", sortable: true, accessor: (row) => formatDate(row.completed_at ?? row.started_at) }, { id: "actions", header: <span className="sr-only">Actions</span>, width: "2.75rem", align: "end", cell: (row) => <BfActionMenu label={`Actions for ${row.status} inbound delivery`} items={[{ value: "open", label: "Open Delivery", icon: <ExternalLink size={14} /> }]} onSelect={() => setSelectedIngest(row)} /> },
  ], []);
  const toolbar = <ReportToolbar search={search} field={field} options={fields[tab]} filters={visibleFilters} onSearch={changeSearch} onField={changeField} onClear={clearUrlFilter} onExport={exportCsv} />;
  const pagination = { page: effectivePage, pageSize: PAGE_SIZE, total: active.total, onPageChange: setPage };

  return <div className="page page-enter" aria-busy={loading || active.loading}><header className="page-header"><div><h1>Reports</h1><p>Provider reports, authentication issues, and every inbound delivery attempt.</p></div></header>
    <section className="report-health" aria-label="Report coverage"><article><span>Provider Reports</span><strong>{tab === "aggregate" ? reports.total : "—"}</strong><small>{tab === "aggregate" ? "Matching the current server-side filters" : "Open Aggregate Reports to view the matching total"}</small></article><article><span>Domains Reporting Here</span><strong>{coverageLoading ? "—" : `${data?.health?.reporting_current ?? 0} / ${expectedDomains.length}`}</strong><small>{coverageLoading ? "Loading coverage…" : "Current within three days"}</small></article><article className={!coverageLoading && missingDomains.length ? "needs-attention" : ""}><span>Awaiting or Stale</span><strong>{coverageLoading ? "—" : missingDomains.length}</strong><small>{coverageLoading ? "Loading coverage…" : missingDomains.length ? "Open domain inventory to investigate" : "No expected reports are overdue"}</small></article><article className={!coverageLoading && data?.health?.recent_ingest_failures ? "needs-attention" : ""}><span>Inbound Failures</span><strong>{coverageLoading ? "—" : data?.health?.recent_ingest_failures ?? 0}</strong><small>{coverageLoading ? "Loading coverage…" : `Across the latest ${data?.health?.recent_ingest_events ?? 0} deliveries`}</small></article></section>
    <BfTabs label="DMARC Report Views" items={[{ id: "aggregate", label: `Aggregate Reports${tab === "aggregate" ? ` (${active.total})` : ""}` }, { id: "failures", label: `Issues${tab === "failures" ? ` (${active.total})` : ""}` }, { id: "inbound", label: `Inbound Activity${tab === "inbound" ? ` (${active.total})` : ""}` }]} value={tab} onChange={changeTab} distribution="equal" />
    {tab === "aggregate" ? <BfDataTable ariaLabel="Aggregate reports" rows={reports.rows} columns={aggregateColumns} getRowId={(row) => row.id} loading={loading || reports.loading} error={errorState("Could not load aggregate reports", reports.error, reports.refresh)} onRowActivate={openReport} sort={sort} onSortChange={changeSort} manualSorting pagination={pagination} toolbar={toolbar} emptyState={{ title: "No aggregate reports match these filters", description: "Try a broader domain, organization, reporter, or date." }} footer={<span>{reports.total} provider reports</span>} maxHeight="min(58vh, 44rem)" minWidth="52rem" /> : null}
    {tab === "failures" ? <BfDataTable ariaLabel="Authentication issues" rows={failures.rows} columns={failureColumns} getRowId={(row) => row.id} loading={loading || failures.loading} error={errorState("Could not load authentication issues", failures.error, failures.refresh)} onRowActivate={openFailure} sort={sort} onSortChange={changeSort} manualSorting pagination={pagination} toolbar={<>{toolbar}<BfMultiSelect className="data-toolbar-filter" label="Sending Sources" value={sources} onValueChange={changeSources} options={sourceOptions} placeholder="All Sending Sources" maxDisplayedItems={1} showBulkActions={false} /></>} emptyState={{ title: "No authentication issues match these filters", description: "Clear a source, date, organization, or search term to widen the result set." }} footer={<span>{failures.total} provider-aggregated result combinations</span>} maxHeight="min(58vh, 44rem)" minWidth="68rem" /> : null}
    {tab === "inbound" ? <BfDataTable ariaLabel="Inbound deliveries" rows={inbound.rows} columns={inboundColumns} getRowId={(row) => row.id ?? `${row.completed_at}-${row.route}-${row.recipients?.join(";")}`} loading={loading || inbound.loading} error={errorState("Could not load inbound deliveries", inbound.error, inbound.refresh)} onRowActivate={setSelectedIngest} sort={sort} onSortChange={changeSort} manualSorting pagination={pagination} toolbar={toolbar} emptyState={{ title: "No inbound deliveries match these filters", description: "Try a broader status, route, or search term." }} footer={<span>{inbound.total} accepted, ignored, or failed deliveries</span>} maxHeight="min(58vh, 44rem)" minWidth="54rem" /> : null}
    {selectedReport || selectedRecord ? <Drawer className="report-drawer" title={report?.domain ?? selectedRecord?.domain ?? "Report Detail"} subtitle={report ? `${reportedValue(report.reporter, "Reporter Not Identified")} · ${formatDate(report.date_end)} · ${formatNumber(report.message_count)} messages` : reportLookup.loading ? "Loading report details" : "Report details unavailable"} onClose={closeReport}><div className="report-detail-summary"><span><strong>{report?.record_count ?? detailTotal}</strong>Result Combinations</span><span><strong>{formatNumber(report?.message_count ?? detailRows.reduce((sum, row) => sum + row.count, 0))}</strong>Messages Represented</span><span><strong>{detailSources}</strong>Sending Sources on this page</span></div>{reportLookup.error ? <div className="table-empty"><AlertTriangle aria-hidden="true" />Could not load this report.<BfButton variant="secondary" onClick={reportLookup.refresh}>Try again</BfButton></div> : null}{reportKey && detail.loading ? <div className="table-empty">Loading retained result combinations…</div> : detail.error ? <div className="table-empty"><AlertTriangle aria-hidden="true" />Could not load retained result combinations.<BfButton variant="secondary" onClick={() => void detail.refresh()}>Try again</BfButton></div> : !detailRows.length ? <div className="table-empty"><AlertTriangle aria-hidden="true" />This report has no retained result combinations.</div> : <><div className="source-groups">{Object.entries(grouped).map(([source, rows]) => <section key={source}><div className="source-heading"><div><strong>{source}</strong><span>{rows.length} result combination{rows.length === 1 ? "" : "s"} on this page</span></div><strong>{formatNumber(rows.reduce((sum, row) => sum + row.count, 0))} messages on this page</strong></div><div className="table-wrap"><table className="report-results-table"><thead><tr><th><div className="report-domain-heading"><strong>Message Domains</strong><span><span title="Header From Domain">From</span><span title="Envelope From Domain">Mail From</span><span title="Envelope To Domain">To</span></span></div></th><th>Source IP</th><th className="numeric">Messages</th><th>DMARC</th><th>SPF</th><th>DKIM</th><th>Disposition</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={selectedRecord?.id === row.id ? "selected-row" : ""}><td><DomainIdentifiers record={row} /></td><td><span className="mono report-source-ip" title={reportedValue(row.source_ip, "Not Reported")}>{reportedValue(row.source_ip, "Not Reported")}</span></td><td className="numeric">{formatNumber(row.count)}</td><td><AuthenticationMark label="DMARC" value={row.classification === "compliant" ? "pass" : "issue"} /></td><td><AuthenticationMark label="SPF" value={row.spf} /></td><td><AuthenticationMark label="DKIM" value={row.dkim} /></td><td className="report-disposition">{row.disposition}</td></tr>)}</tbody></table></div></section>)}</div><BfPagination className="report-detail-pagination" page={detailPage} pageSize={DETAIL_PAGE_SIZE} total={detailTotal} onPageChange={setDetailPage} label="Report Result Pagination" /></>}</Drawer> : null}
    {selectedIngest ? <Drawer className="ingest-drawer" title="Inbound Delivery" subtitle={formatDate(selectedIngest.completed_at)} onClose={() => setSelectedIngest(undefined)}><div className={`ingest-result ${selectedIngest.status}`}>{selectedIngest.status === "completed" ? <Check aria-hidden="true" /> : selectedIngest.status === "failed" ? <AlertTriangle aria-hidden="true" /> : <Inbox aria-hidden="true" />}<div><strong>{selectedIngest.status}</strong><span>{selectedIngest.error || selectedIngest.ignore_reason || "Processed without an error."}</span></div></div><dl><div><dt>Route</dt><dd>{selectedIngest.route || "Not recorded"}</dd></div><div><dt>Recipients</dt><dd>{selectedIngest.recipients?.join(", ") || "Not recorded"}</dd></div><div><dt>Reports</dt><dd>{selectedIngest.report_count ?? 0}</dd></div><div><dt>Messages represented</dt><dd>{selectedIngest.message_count ?? 0}</dd></div><div><dt>Signature</dt><dd>{selectedIngest.signature_status?.replace(/_/g, " ") || "Not recorded"}</dd></div></dl></Drawer> : null}
  </div>;
}

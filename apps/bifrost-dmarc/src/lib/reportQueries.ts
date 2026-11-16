export type ReportTab = "aggregate" | "failures" | "inbound";

export interface ReportQueryInput {
  tab: ReportTab;
  days?: number;
  organizationId?: string;
  domain?: string;
  activeDomains?: string[];
  exactDate?: string;
  sources?: string[];
  searchField?: string;
  search?: string;
  page: number;
  pageSize?: number;
  orderBy: string;
  orderDir: "asc" | "desc";
  now?: Date;
}

function dayAfter(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isCalendarDay(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addContains(where: Record<string, unknown>, field: string, value: string) {
  const existing = where[field];
  if (existing === undefined) {
    where[field] = { contains: value };
    return;
  }
  where[field] = typeof existing === "object" && existing !== null
    ? { ...existing as Record<string, unknown>, contains: value }
    : { eq: existing, contains: value };
}

function dateWindow(days: number | undefined, now: Date) {
  const normalizedDays = Math.min(Math.max(Math.trunc(days || 30), 1), 90);
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - normalizedDays);
  return { gte: start.toISOString().slice(0, 10), lt: end.toISOString().slice(0, 10) };
}

const dateFields: Record<ReportTab, string> = {
  aggregate: "date_end",
  failures: "date",
  inbound: "started_at",
};

/** Builds the table-only AND filter used by paged Reports views. */
export function buildReportQuery({
  tab,
  days,
  organizationId,
  domain,
  activeDomains,
  exactDate,
  sources = [],
  searchField,
  search,
  page,
  pageSize = 50,
  orderBy,
  orderDir,
  now = new Date(),
}: ReportQueryInput) {
  const where: Record<string, unknown> = {};
  const dateField = dateFields[tab];

  if (organizationId && tab !== "inbound") where.organization_id = organizationId;
  if (tab !== "inbound") {
    if (domain) where.domain = activeDomains?.includes(domain) === false ? { in: [] } : domain;
    else if (activeDomains) where.domain = { in: activeDomains };
  }
  where[dateField] = isCalendarDay(exactDate)
    ? { gte: exactDate, lt: dayAfter(exactDate!) }
    : dateWindow(days, now);
  if (tab === "failures") {
    where.classification = { ne: "compliant" };
    if (sources.length) where.sending_source = { in: sources };
  }
  if (search?.trim() && searchField) addContains(where, searchField, search.trim());

  return { where, page, pageSize, order_by: orderBy, order_dir: orderDir };
}

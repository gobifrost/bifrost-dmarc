import { describe, expect, it } from "vitest";

import { buildReportQuery } from "./reportQueries";

describe("buildReportQuery", () => {
  it("applies the bounded URL date window and selected search field before pagination", () => {
    expect(buildReportQuery({
      tab: "failures",
      days: 120,
      organizationId: "org-1",
      domain: "example.com",
      exactDate: "2026-08-13",
      sources: ["Forwarder", "Google Workspace"],
      searchField: "source_ip",
      search: "192.0.2",
      page: 2,
      orderBy: "source_ip",
      orderDir: "asc",
    })).toEqual({
      where: {
        organization_id: "org-1",
        domain: "example.com",
        date: { gte: "2026-08-13", lt: "2026-08-14" },
        classification: { ne: "compliant" },
        sending_source: { in: ["Forwarder", "Google Workspace"] },
        source_ip: { contains: "192.0.2" },
      },
      page: 2,
      pageSize: 50,
      order_by: "source_ip",
      order_dir: "asc",
    });
  });

  it("uses a 30-day default window and excludes compliant records from issues", () => {
    expect(buildReportQuery({
      tab: "failures",
      days: 0,
      page: 1,
      orderBy: "date",
      orderDir: "desc",
      now: new Date("2026-08-13T16:00:00Z"),
    })).toMatchObject({
      where: {
        date: { gte: "2026-07-15", lt: "2026-08-14" },
        classification: { ne: "compliant" },
      },
      pageSize: 50,
    });
  });

  it("keeps the active-domain scope when a matching field is searched", () => {
    expect(buildReportQuery({
      tab: "aggregate",
      activeDomains: ["example.com", "other.example"],
      searchField: "domain",
      search: "example",
      page: 1,
      orderBy: "date_end",
      orderDir: "desc",
      now: new Date("2026-08-13T16:00:00Z"),
    }).where.domain).toEqual({ in: ["example.com", "other.example"], contains: "example" });
  });

  it("treats malformed exact dates as the normal bounded window", () => {
    expect(buildReportQuery({
      tab: "aggregate", exactDate: "not-a-date", page: 1, orderBy: "date_end", orderDir: "desc", now: new Date("2026-08-13T16:00:00Z"),
    }).where.date_end).toEqual({ gte: "2026-07-15", lt: "2026-08-14" });
  });
});

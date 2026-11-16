# Live data contract

This matrix is the architectural delivery contract for Bifrost DMARC UI state. A workflow may perform a mutation, but a successful mutation must not require a broad dashboard query to make table-backed state current.

| Product surface | UI source of truth | Mutation boundary | Update behavior |
| --- | --- | --- | --- |
| Domain inventory, mappings, lifecycle, DNS posture | `dmarc_domains` live subscription | Workflows for Cloudflare sync, manual creation, mapping propagation, archive/restore, and guarded DNS writes | Table insert/update/delete events update every subscribing page |
| Organization counts and coverage | Bifrost Organization directory plus live `dmarc_domains` rows | Mapping workflows | Counts are derived in the client from current domain rows |
| Overview metrics and sending sources | `dmarc_daily_metrics` live subscription | Resend/synthetic ingestion workflows | Trends, totals, rates, and source rankings are derived from the selected live date window |
| Aggregate Reports | One filtered `dmarc_reports` page | Resend/synthetic ingestion workflows | The active Reports tab refreshes its current 50-row page on live changes |
| Authentication issues and report drilldown | One filtered `dmarc_records` page | Resend/synthetic ingestion workflows | Issues load on tab selection; opening a report loads 25 records at a time by its immutable report key |
| Inbound health and shell status | `dmarc_ingest_events` | Resend inbound workflow | The shell reads one latest delivery without counting the table; the Inbound tab loads a filtered 50-row page |
| Email Investigation | Latest 25 `dmarc_investigations` rows on Settings | Investigation issue/upload/inbound workflows | Waiting, processing, completed, failed, and expired states update live |
| SPF migration inventory | `dmarc_spf_sources` live subscription | Import and future guarded source-management workflows | Sender inventory changes update Migration immediately |
| DNS change history | One 25-row `dmarc_dns_changes` page on Settings | Guarded Cloudflare write workflow | Live changes refresh the current page; earlier history remains available through pagination |
| Migration progress | Latest `dmarc_migration_runs` row and tasks for that run | Bulk migration workflow | Only Migration subscribes to progress; unrelated historical tasks are not loaded |
| Reporting-domain and signing-secret status | Thin `get_app_context` workflow | Encrypted configuration workflow | Explicit context refresh only after configuration changes |
| Bifrost Organization directory | Thin `get_app_context` workflow | Bifrost platform organization management | Loaded as non-table context; no DMARC table payload is duplicated |

## Mutation rules

- Use direct Tables subscriptions for all table-backed reads.
- Keep workflows for external integrations, secrets, security validation, and multi-table coordination.
- Do not call `get_dashboard` or reload the route after a table-backed mutation.
- Use one bulk workflow request for a multi-row operator action; do not loop workflow calls in the browser.
- Derive overview totals, rates, source rankings, and reporting recency from daily summaries. Older summary rows use their report-period date when an exact `last_report_at` is absent.
- Surface table subscription failures separately from mutation failures; reconnects refresh only the requested page or summary window. Coalesce live event bursts and discard responses belonging to an old query.

## Coverage limits

Only domain/SPF inventories, daily summaries, and the latest migration run's tasks are fully loaded in 1,000-row pages. Overview summaries use the selected organization and date range in the server query; domain and migration evidence use a 30-day summary window. Reports, records, and history never automatically drain their tables.

Report organization, active-domain, date, source, search-field, and sort selections apply before server pagination. Search has an explicit field because the Tables filter DSL combines fields with AND rather than supporting cross-field OR. CSV export is explicitly limited to the current page. Report drawers query records by `report_key` independently of the list's date filter, so retained detail is not hidden by a narrower list window.

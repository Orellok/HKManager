# M4.1 – Dashboard + exempt-dealer ceiling (DASH-1..6, CEIL-1..6)

Source: SPEC.md sections 3, 4, 5.9, 5.10, 6 (`tax_year_settings`, `ceiling_alert_acks`, aggregation views), 7, 8 (performance, a11y), 10. Criteria set by the lead under the owner's pre-approval (2026-11-23). M4 split: M4.1 dashboard + ceiling; M4.2 CSV export.

## Acceptance criteria
1. Migrations: `tax_year_settings` (year unique, exempt_ceiling bigint agorot; seed 2026 = 12,283,300) and `ceiling_alert_acks` (year, threshold ∈ {70,85,95}, acked_by, acked_at; unique(year, threshold)). RLS: read for allowlisted users; `tax_year_settings` write admin only; acks insert by allowlisted users, no update/delete. `app_settings.turnover_basis` seeded `received_date` (`receipt_date` supported).
2. DB aggregations (no row-by-row JS sums): monthly/yearly income and expense totals, 12-month series, expenses by category, turnover for a tax year by `turnover_basis` (received_date = income received_date; receipt_date = document issued_date). Calendar tax year (DASH-6), Asia/Jerusalem. Soft-deleted rows excluded.
3. DASH-1/2: period selector month/year (default current month); income, expenses, profit, comparison to previous period (absolute and %; "—" when previous is 0).
4. DASH-3: 12-month income vs expense chart (Recharts – SPEC 3/7; the only new dependency, pinned exactly), with an accessible table alternative; CSP-safe (no inline style violations under the nonce CSP – verify; if Recharts needs inline styles, find a compliant approach or stop and report).
5. DASH-4: expenses by category for the selected period (chart + accessible list).
6. DASH-5 action cards: open debts (count + total, link), pending receipts (existing card moved here), expenses missing a document (count, link to filtered list), today's events and tasks – **placeholders hidden** until M5/M6 (no fake data).
7. CEIL-3: persistent progress bar: turnover, ceiling, %, remaining.
8. CEIL-4: banners at crossing 70/85/95% until acknowledged; ack stored per year+threshold (shared by both users).
9. CEIL-5: at ≥100% a non-dismissible banner "יש לפנות לרואה חשבון/רשות המסים".
10. CEIL-6: year with no ceiling row → bar shows "תקרה לא הוגדרה" (never the previous year's value); admin sees a prompt to set it.
11. Admin settings: "תקרות שנתיות" section under הגדרות (admin only via `requireAdmin()`; owner gets 404): list years, add/edit ceiling. This is also the first real E2E for "owner blocked by requireAdmin()" (deferred since M0.3).
12. Performance: dashboard data in ≤ a few DB round trips; target load ≤ 2s on mid-range 4G (measure server timing locally and report).
13. Carry-overs: expenses row hover contrast; focus to the camera input after a photo error; close "עוד" on focus-out; `staging-deploy.yml` concurrency moved to the deploy job.
14. Inherited lessons, a11y (WCAG 2.1 AA, charts with text alternatives), RTL, no horizontal scroll at 360/412/1280.
15. Tests: unit (comparison math, thresholds, ceiling states, year boundary 31/12–1/1 in Asia/Jerusalem); integration (RLS, aggregations exactness incl. soft-deleted exclusion and basis switch, acks uniqueness); E2E (period switch, chart table alternative, banners 70/85/95/100, ack shared, no-ceiling year, admin ceiling screen, owner 404). Names include DASH-x / CEIL-x.

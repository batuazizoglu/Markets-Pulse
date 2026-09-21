# Markets Pulse by Turkcell

**Markets Pulse** is a competitive intelligence and market-monitoring platform built for the Northern Cyprus telecom market. It continuously collects competitor and market data, normalizes product catalogs, detects meaningful changes, preserves evidence, compares comparable products, and turns the results into executive dashboards and scheduled reports.

> Production: **https://www.marketspulse.cloud**

## What Markets Pulse does

Markets Pulse combines multiple monitoring layers in a single platform:

- **Mobile competitor monitoring** — Telsim postpaid, prepaid and other tariff catalogs
- **Turkcell product benchmarking** — KKTCELL prepaid, postpaid, GNÇ and Platinum catalogs
- **Comparable Product Engine** — segment, product family, data, minutes, validity, benefits and pricing based matching
- **Fixed Home Internet intelligence** — Turkcell Home Internet and competing ISPs
- **FWA intelligence** — Superbox and Red Box tracked separately from fixed broadband
- **Change detection** — price, data, minutes, SMS, validity, benefits, product additions/removals and commercial conditions
- **Evidence Archive** — focused package screenshots, full-page screenshots, raw HTML, parsed JSON and metadata
- **Executive reporting** — daily and weekly management summaries, PDF reports and HTML e-mail reports
- **Competitive Pressure & Market Position** — segment-based competitive scoring, trend and action signals
- **Admin access control** — database-backed users, roles, secure sessions and mandatory first-login password change
- **Match Review workflow** — admin review and override layer for product-to-product comparisons

## Main modules

### Dashboard
Executive overview of competitive pressure, strongest/weakest segments, competitor moves and recommended actions.

### Competitor Tracking
Source health, Telsim catalog monitoring, detected changes, historical product versions and evidence records.

### Product Comparison
KKTCELL and Telsim products are compared through the Comparable Product Engine instead of simple price/data proximity. The engine considers:

- billing type
- segment / eligibility
- product family
- core data and bonus/pass data
- local/TR minutes
- international minutes
- validity period
- SMS
- digital/app benefits
- acquisition/channel conditions
- price level
- mutual-best-match confidence

Comparable Product Engine **v2.4 is live**. The dashboard, Match Review and all mobile reports share one engine and the same persisted admin decisions. Primary matches drive Competitive Position scores and advantage totals. Secondary alternatives are shown separately and do not affect scores; Review and Reject are excluded.

Saved decisions are revalidated against the current catalog and hard gates. A missing or newly ineligible peer remains saved but moves to Review; it never silently falls back to an automatic match. Admin identities and notes remain on the admin-only review endpoint.

Score history is tagged `2.4.1-live`. Included benefits such as “Sınırsız ek uygulamalar” do not turn core tariffs into add-ons; product-name classification is used. Segments without Primary matches include explicit catalog/matching reasons in the dashboard and PDF/email reports. Older records are preserved but never used for current-engine deltas or monthly averages. If the deployment shares an hourly bucket with an old-engine record, that record is preserved and the new history starts in the next available hour. No historical scores are recalculated. The legacy `BENCHMARK_V2_SHADOW_RUN` flag is no longer needed to activate matching; the application uses v2.4 directly.

### Turkcell Home Internet
Fixed broadband is monitored separately from mobile. The module tracks providers, technology, speed, contract duration, installation cost, effective monthly price, total cost of ownership and Mbps/100 TL.

### Superbox / Red Box
FWA products are treated as their own competitive market. Superbox and Red Box are therefore not mixed with conventional fixed broadband or mobile tariffs.

### Reports
Markets Pulse generates and distributes:

- Daily Executive Summary
- Weekly Executive Summary
- Monthly Consolidated Executive Report (rolling last 30 days)
- Last 7 Days: What Did Telsim Do?
- Evidence Pack
- Turkcell Home Internet Competition Report
- Superbox / Red Box Competition Report

Daily and weekly executive e-mails include **mobile**, **Turkcell Home Internet** and **Superbox / Red Box** as separate management sections.

The **Aylık Birleşik Yönetici Raporu** card in Reports combines all report families into one PDF and an HTML e-mail summary: mobile pressure/position and segment trends, Telsim package changes, fixed home-internet benchmarking, Superbox/Red Box, evidence coverage, source health and suggested next-period actions. Download via `GET /api/reports/monthly/download`; `POST /api/reports/monthly/email` uses the existing signed-in-user delivery path.

Monthly means the **rolling last 30 days**, not the previous calendar month. Event totals use original database records without adding overlapping daily/weekly reports, with one frozen half-open time window. Current catalogs and benchmark scores are explicitly distinguished from historical changes and weekly recorded-score averages. Missing baseline/history is disclosed, never filled with invented deltas. Detail tables and visual evidence are selected subsets; totals cover all matching events. No new monthly email schedule is enabled, and generating/downloading a report does not send mail.

## Evidence Archive

For monitored competitor pages, Markets Pulse can store multiple layers of evidence together:

- Focused package screenshot
- Full-page PNG
- Raw HTML
- Parsed JSON
- Scan and source metadata

Open **Kanıt Arşivi** from the sidebar to browse the saved Telsim tariff-page records:

- Search by package name, source name or record ID, including Turkish characters.
- Filter by source, date range in KKTC time (`Asia/Famagusta`), record type and missing files.
- Browse all matching records in pages of 24 with card or list views.
- Inspect focused/full-page images with zoom, searchable package data and scan changes.
- Compare a record with the preceding saved record of the same source; it may be older than the previous day.
- Download individual files or select up to 10 records across pages for a ZIP containing all available originals, changes and a SHA-256 manifest. Missing files are listed explicitly.
- Copy a record link with the current filters. Opening it requires a platform session.

Records are captured at baseline, on changes and approximately once per day. The archive currently covers the three Telsim tariff sources; file availability varies by record. Existing records are preserved and do not need recapturing.

## Architecture

- **Node.js 20+**
- **Express** web/API server
- **PostgreSQL** on Railway
- **Puppeteer** for dynamic pages and visual evidence
- **Cheerio** for HTML parsing
- **node-cron** for scheduled scans and reports
- **Brevo transactional API** for management e-mails and user invitations
- **Railway** for application hosting and PostgreSQL

### High-level flow

```text
Official Sources
      ↓
Collectors / Crawlers
      ↓
Normalization & Product Fingerprints
      ↓
Change Detection + Evidence Capture
      ↓
PostgreSQL History
      ↓
Comparable Product / Intelligence Engines
      ↓
Dashboard • Reports • E-mail • Evidence Pack
```

## Monitored source groups

### Telsim Mobile

- Postpaid tariffs
- Prepaid tariffs
- Other postpaid / special segment tariffs

### KKTCELL Mobile

- Prepaid
- Postpaid
- GNÇ
- Platinum

### Turkcell Home Internet

- KKTCELL Home Internet
- Lifecell Digital fixed internet catalog

### FWA

- KKTCELL Superbox
- Lifecell Digital Superbox
- Telsim Red Box

### Other fixed broadband competitors

Markets Pulse also monitors selected Northern Cyprus ISP catalogs for fixed internet benchmarking.

## Authentication & roles

The dashboard uses database-backed authentication rather than shared Basic Auth credentials.

- `admin` and `standard` roles
- HttpOnly / Secure session cookie
- server-side API authorization
- mandatory password change on first login
- temporary credentials delivered individually by e-mail
- failed-login lock protection
- admin-only user management and match review screens

Secrets and temporary passwords are never stored in this repository.

## Railway deployment

The production service is deployed from:

```text
GitHub: batuazizoglu/Markets-Pulse
Branch: main
Runtime: Railway
Database: Railway PostgreSQL
Production domain: www.marketspulse.cloud
```

Railway supplies `PORT`. The application health endpoint is:

```text
GET /api/health
```

### Important environment variables

Values must be configured in Railway and must **not** be committed to GitHub.

```text
DATABASE_URL
PORT
NODE_ENV
BREVO_API_KEY
REPORT_EMAIL_FROM
REPORT_EMAIL_TO
USER_EMAIL_FROM
INITIAL_USERS_JSON
REPORT_DAILY_CRON
REPORT_WEEKLY_CRON
```

Additional crawler/report variables may be configured depending on the production environment.

## Development

```bash
npm install
npm run dev
```

Production start:

```bash
npm start
```

Requires Node.js 20+ and a PostgreSQL database.

Archive tests and a local preview use an in-memory PostgreSQL fixture with synthetic records. They do not connect to production or start scan/e-mail jobs:

```bash
npm test
npm run preview:evidence
# Open http://127.0.0.1:4173/#evidence
```

Install development dependencies first. Tests also require `python3` (standard-library ZIP/hash verification). API tests exercise real SQL; DOM tests cover archive interactions. DOM tests do not verify rendered layout or native browser dialog behavior.

## API overview

Selected endpoints include:

```text
GET  /api/health
GET  /api/summary
GET  /api/packages
GET  /api/changes
GET  /api/scans
GET  /api/snapshots
GET  /api/evidence?q=&source=&from=&to=&kind=&availability=&page=1&limit=24
GET  /api/evidence/:id
GET  /api/evidence/export?ids=1,2
GET  /api/snapshots/:id/focus?download=1
GET  /api/snapshots/:id/image?download=1
GET  /api/snapshots/:id/html?download=1
GET  /api/snapshots/:id/json?download=1
GET  /api/market-pulse
GET  /api/kktcell-catalog
GET  /api/benchmark
GET  /api/benchmark-history
GET  /api/home-internet
GET  /api/home-internet/changes
POST /api/home-internet/scan
GET  /api/reports/status
GET  /api/reports/:type/download
POST /api/reports/:type/email
```

Authentication and admin endpoints are protected server-side.

## Product philosophy

Markets Pulse is designed around three principles:

1. **Comparable products, not merely similar prices** — products should only be benchmarked when their segment, family and commercial content make the comparison meaningful.
2. **Evidence before assumption** — important competitive changes should remain auditable through archived source evidence.
3. **Decision-ready output** — dashboards and reports should explain what changed, why it matters and which action deserves attention.

---

**Markets Pulse by Turkcell**  
Competitive Intelligence • Northern Cyprus

## BTHK ISP coverage and home internet monitoring

The `Ev İnterneti` area has **Rakip Takip**, **Ürün Karşılaştırma**, and **Reklam & Sayfalar** views.

- `src/isp-registry.js` contains all 29 legal entities named on printed pages 67–68 of the [BTHK 2026 Q2 report](https://www.bthk.org/Documents/raporlar/pazar-verileri-sektorel-raporlar/2026%20Q2%20Raporu.pdf). The report overview counts 28 respondents; the named appendix contains 29 companies. This is a scope list, not a claim that all companies currently publish prices.
- Official sites were cross-checked with the [BTHK authorized-provider directory](https://www.bthk.org/en/yetkilendirilen-haberlesme-saglayicilar/) on 2026-09-17. Cyberspace Solutions and Hypernet remain explicitly unverified; unrelated namesakes are not used.
- Extend maps to Arınet. Nethouse, Kıbrıs Online and Multimax map to Netonline. Brand and legal-entity counts remain separate.
- The 2026-09-18 catalog check adds Extend VDSL/Game Pack, Broadmax Apartman, Multimax Apartman/Plus/corporate services, XrealNet at `xrealinternet.com`, and Comtech FiberNet/Wireless. Old Broadmax/Multimax/Towernet paths are documented alongside verified current catalogs. Multimax's old Özgür URL returns 404; no unverified replacement or historical price is presented as current.
- FixNet campaigns are saved separately in scan metadata and displayed with validity/expiry. Expired and unconfirmed campaigns never become priced offers. Changes to campaign conditions and expiry enter the same change feed; a failed fetch retains the last verified campaign list.
- Package prices come from official pages or their public embedded JSON. No customer account or private API is used. Failed fetches, empty parsing and a sudden loss of more than half a catalog preserve the last verified version and flag source health.
- Parser-version changes establish a new baseline without emitting mass removals or price changes. Retained or >26-hour-old data is marked stale and excluded from automatic benchmark metrics.
- Source-specific revisions establish a baseline only for a corrected source, preserving other catalogs. Extend's period/gift headers and current installation notes are read from the page instead of fixed historical assumptions.
- Payment period, gift months and gift days are separate. For a day-based offer, 30 days equal one comparison month. A 12-month equivalent is an analytical estimate, not a quoted annual contract. Installation, cable and modem charges are not silently included. Quote-only services have no invented price or term.
- Comparison supports 2–4 offers, displays source/time/contract details and flags different technologies, speeds, terms or service types. Fixed and FWA offers are selected separately.
- The social view provides verified account links and country-selectable Ad Library links. Telsim's supplied page ID is 164143610515. Unknown page IDs use an explicitly labelled brand search.
- Social observations are manual, authenticated records with a Facebook/Instagram source link and note. They are saved in `social_watch_observations`; no message or email is sent.
- **Cloud visual analysis** runs in Railway with a durable Postgres queue: public Ad Library screenshots, bounded vision inference and separate home/GSM/MNP results. Daily scheduling and retries run independently of ChatGPT and user browser sessions. The UI distinguishes captured images, pending analysis, missing API configuration and source failures. See [cloud operation instructions](docs/ad-visual-automation.md).

Additional API endpoints:

```text
GET  /api/home-internet/social-observations
POST /api/home-internet/social-observations
```

`npm test` uses isolated fixtures and does not contact production. Optional `node test/inspect-isp-sources.mjs` reads public package sources and reports parsing health; it never sends applications, messages or emails.

Automated tests cover catalog scope, price separators, gift periods, failed-scan retention, campaign expiry/history, source revisions, UI selection/escaping and persisted social observations. Browser smoke checks exercise all three views at 1440px and 390px, including campaign expansion. Public-site failures remain explicit source-health records.


### Advertising visual analysis

- A dedicated **Reklam Analizi** route exposes **Ev İnterneti**, **GSM Paketleri**, and **MNP / Numara Taşıma** separately. AI can create and reuse evidence-supported categories for other advertising; these appear automatically in filters and reports. Historical other/ambiguous records are reanalyzed from saved images within the existing daily limit. Home internet also embeds only the home category in Reklam & Sayfalar.
- Captured screenshots, caption, prices, allowance/speed, observed conditions, uncertainties, advertiser/ad/variant identity, and capture/observation timestamps are preserved. Unknown values remain null. Read-only endpoints are protected by the existing application authentication.
- SHA-256 evidence validation, bounded capture/model calls, persistent leases and retry limits, chronological upserts and transactional publication preserve previous observations. Missing ads are never automatically deactivated. The legacy GitHub importer remains available only for historical maintenance, not scheduled production work.
- Business field changes create history versions; screenshot/timestamp/prose-only changes do not. Reports label first observations separately from changes and do not equate first observation with launch.
- Daily, weekly and monthly reports include category-specific visual-analysis summaries. Home/FWA reports include home-category advertising.
- Cloud capture runs on the server; inference needs `OPENAI_API_KEY` in Railway. Optional `AD_VISION_MODEL` and `AD_VISION_DAILY_LIMIT` configure the model and persistent daily call cap. Without a key, evidence waits safely in the queue and the UI explicitly reports the missing connection. The old ChatGPT task and GitHub feed are retired.
- Set `AD_CAPTURE_PROVIDER=apify` to use the cloud dataset collector independently of the browser/proxy pool. It uses Apify's maintained `apify/facebook-ads-scraper`, with the registry's verified page IDs and existing active/CY/all-media filters. No result limit is sent. Dataset pagination, carousel cards, extra images and video preview images are ingested individually. A video preview is explicitly labeled; full video playback is not analyzed. Pages without a verified numeric ID remain visible as unverified sources.
- Daily advertising batches start at or after 06:00 Asia/Famagusta, with catch-up after a later restart. Apify queues all verified advertiser pages; browser capture rotates up to six competitors alongside Telsim. Shared page IDs and pending page jobs are deduplicated. Provider spend and OpenAI call limits remain independent; work beyond either daily budget stays queued. Newly verified pages join on the next worker tick. See [runtime and scheduling](docs/ad-visual-automation.md#runtime-and-schedule).
- Configure `APIFY_TOKEN`, `APIFY_MAX_RUN_USD` and `APIFY_DAILY_BUDGET_USD` in Railway. Both USD caps (at least 0.01, at most two decimal places) are required, with per-run cap no greater than daily cap (maximum 10/run and 100/day). Provider collection incurs separate provider charges; OpenAI credit does not cover it. Daily reservations conservatively count each run's maximum authorized cost and persist across restarts. A lost/ambiguous run-start response is marked `start_unknown` for operator reconciliation instead of starting another billable run.
- Provider runs, dataset offsets and each creative's download state persist in PostgreSQL. Up to two runs can progress when a source is waiting, with three media downloads per worker tick; source-specific Retry-After remains enforced. Dataset pages commit before media download; replay does not inflate capture counts or reset paid AI attempts. Only bounded HTTPS image downloads from Meta's CDN are accepted, without the provider token or cookies. Images are decoded and normalized to bounded JPEG evidence. API auth errors, source denial and unknown coverage never become “no ads.” Completeness means the provider explicitly completed the selected source/filter and every returned creative was archived; it does not attest to every ad on Meta. Missing assets and partial runs remain visible.
- The advertising archive uses bounded cursor pages and “load more,” so records after the first 400 remain accessible. Category/brand totals are computed across the archive. Provider collection and AI classification have separate queues; downloaded evidence can wait for the existing model budget before appearing as an analyzed card. The main advertising page also exposes an authenticated, paginated pending-evidence gallery (50 per page) so these stored images can be opened before classification, without making category or offer claims.
- Verification: node --test test/ad-visual.test.js; node test/ad-visual-layout.mjs. CI verifies 1440px/390px layouts for all three categories and existing home views, using synthetic data.

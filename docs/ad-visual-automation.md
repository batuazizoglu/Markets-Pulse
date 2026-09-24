# Markets Pulse cloud advertising analysis

## Runtime and schedule

The Railway application runs the producer itself. No ChatGPT task, personal browser session, GitHub feed or open user tab is required. The legacy ChatGPT producer is retired; do not publish new scheduled observations to `ad-visual-data`. Existing analyzed records and evidence remain in Postgres.

The server checks its durable advertising queue every minute, with an initial tick 15 seconds after startup. At or after **06:00 Asia/Famagusta** it schedules the current local day's batch, including when the server restarts later that day. Daylight-saving changes follow that time zone. `ad_cloud_control.scheduled_day` prevents repeating the daily batch across restarts; missed historical days are not replayed.

With `AD_CAPTURE_PROVIDER=apify`, each daily batch includes **every verified numeric advertiser page**, with Telsim first. The browser collector schedules Telsim plus up to six least-recently-queued competitors. Keyword-only sources remain in the directory but cannot consume capture slots. Shared page IDs are queued once: Telsim is the preferred brand for its page, and Turkish alphabetical brand order selects the other shared pages. Pending jobs for a page, including jobs under another brand using that page, retain their existing queue position and retry wait. Manual scans use the same selection, coalesce active work and have a durable five-minute throttle. The status API exposes the scheduled time, unique verified-page count and the last local day actually scheduled.

Queueing a daily batch does not guarantee that every page is collected or every image analyzed that day. Provider run reservations and the independent OpenAI daily call limit remain enforced; excess work stays queued and resumes when its budget is available. Provider starts reserve `APIFY_MAX_RUN_USD` each against `APIFY_DAILY_BUDGET_USD`, including failed or ambiguous starts. Increasing registry coverage does not increase either configured budget. A database lease serializes workers across replicas. Interrupted browser captures retry at most three times; accepted provider runs resume from their stored run IDs, dataset offsets and media state. Completed evidence remains saved through restarts.

The **Bulutta tara** button queues work and returns immediately. The user can close the page. **Sonuçları yenile** reads the current state without scheduling another job or disrupting expanded cards automatically.

The advertising API returns `source_directory` independently of analyzed images. Brand selectors include registered sources even when capture failed. Source status uses current cloud jobs ahead of historical feed coverage, so an old no-ads result cannot hide a newer access failure. Selecting an ISP with no published analysis shows its source outcome and Ad Library link without fabricating an ad card. A blocked capture is not evidence of zero active ads. Production logs on 2026-09-20 recorded HTTP 403 for both Nethouse and Kıbrıs Online; dashboard and scheduling fixes do not by themselves resolve Meta access.

Newly verified numeric pages receive one initial source job on the next worker tick, even before 06:00 or after the daily batch has already been scheduled. Historical jobs without that page ID do not suppress registration. Existing capture history for the same page under another brand does suppress duplicate registration. The worker lease and durable source batch key prevent repeated registration on restart; subsequent daily selection follows the chosen collector mode. When changing to Apify, the provider handoff queues one initial provider job for pages without provider history, retaining existing eligible work. It preserves accepted and ambiguous provider starts and their spend reservations. None of these steps resets or increases either daily budget.

## Capture and identity

`src/ad-cloud-capture.js` launches headless Chromium in Railway and reads public rendered Ad Library cards. Only registry-verified numeric Facebook page IDs are scanned. A known profile URL or similarly named keyword result is not enough to assign advertiser identity; unresolved brands are recorded as unverified. CY is the recorded country filter. Each source run saves up to 12 visible ad cards, with the card identity and a separate creative screenshot when available. This bounded scan is partial coverage, not a count of all active campaigns or all variants.

The collector uses normal public page navigation with no login credentials, private GraphQL requests, stealth plugins, proxy rotation or challenge bypass. A real cookie consent option may be clicked; login/challenge overlays are never removed. Access failures and DOM parsing failures are not interpreted as zero ads. Loaded video frames with real dimensions can be captured even when there is no separate image element. Video analysis covers only the captured frame. Entire video playback and carousel traversal are not implemented.

HTTP 429 is a temporary source rate limit. Respect `Retry-After` with a 15-minute minimum, including valid waits longer than 24 hours, pause all source collection until that time, and retry the source at most three times. Stored-image AI analysis continues during the pause. Historical HTTP 429 jobs from the last two days may resume after the same cooldown; HTTP 403 and challenge/access restrictions remain blocked and are not automatically retried by this recovery logic. Do not claim these restrictions are fixed by adding an OpenAI key or by retry scheduling.

Every screenshot is SHA-256 checked and saved directly to `ad_visual_evidence` before model inference. `ad_cloud_candidates` stores the evidence references, advertiser/ad identity, caption and actual capture time in the same transaction. Captured but unanalyzed cards do not appear as completed analyses. Old validated cards are never removed just because a scan fails or misses them.

### Primary public-page proxy transport

While official Ad Library API authorization is pending, production uses configured forward proxies for public-page capture. This does not grant API permissions. Configure these in **Railway → Market Pulse → Variables**; keep provider credentials out of the repository and chat:

- `AD_CAPTURE_TRANSPORT=proxy`: require the proxy for all Ad Library browser requests. There is no automatic direct fallback.
- `AD_CAPTURE_PROXY_URL`: one provider HTTP or HTTPS forward-proxy endpoint, including its port. Paths, query strings, SOCKS endpoints and provider scraping API URLs are not supported. The proxy must support HTTPS CONNECT.
- `AD_CAPTURE_PROXY_USERNAME` and `AD_CAPTURE_PROXY_PASSWORD`: both required when the provider uses username/password authentication. Alternatively the URL may contain URL-encoded credentials; do not configure both forms.
- `AD_CAPTURE_PROXIES`: alternative JSON array of 1–5 providers. Use this instead of the single URL/credentials. Each entry has a unique `id`, `url`, and optional `username`/`password` pair. IDs contain only letters, digits, `_` or `-`, up to 32 characters. Members must use distinct endpoint origins (scheme, host and port); the same gateway with different credentials is still a duplicate. Duplicate endpoints and invalid entries reject the whole configuration; they never trigger direct access.

Example structure for the multi-proxy Railway variable (replace the placeholders with your provider settings in Railway):

```json
[
  {"id":"primary","url":"https://proxy-a.example:8443","username":"PROVIDER_USER_A","password":"PROVIDER_PASSWORD_A"},
  {"id":"backup","url":"https://proxy-b.example:8443","username":"PROVIDER_USER_B","password":"PROVIDER_PASSWORD_B"}
]
```

Selection skips proxies whose transport cooldown has not expired, then prefers fewer consecutive transport failures; configured order breaks ties. This lets healthy or untouched connections run before previously failed ones even when a source's 10-minute retry occurs after their initial 5-minute cooldown. An exact job pin still takes precedence over this ranking. A confirmed failure to connect to the upstream proxy, or its HTTP 502/503/504 gateway failure before successful page navigation, can select one backup. A source run uses at most two proxies within its shared 110-second budget. Existing source jobs still have at most three attempts. Empty/unknown page structure, missing images, general browser timeouts and failures after successful page navigation do not trigger switching.

Transport failures persist in `ad_cloud_proxy_health`: a failing proxy waits 5, 10, 20, 40 and then at most 60 minutes after consecutive failures. Successful ad capture or an explicit no-ads response resets its transport cooldown. This is passive health tracking from actual collection, not a separate probing job. Health records contain a fingerprint and safe result codes, never endpoints or credentials. Restarting Railway does not reset cooldowns. The UI distinguishes unverified, last-successful and temporarily waiting connections; availability alone is not evidence of successful Meta access.

Once evidence has been saved, a source job stays on its selected proxy. HTTP 429 pauses collection globally using `Retry-After` and pins the same proxy for that job's later retry. Access denials, authentication failures and challenges do not switch proxies. A pinned proxy removed from configuration leaves its job waiting explicitly, without spending attempts or selecting another endpoint; restore that configuration to resume it. When all eligible proxies are cooling down, jobs likewise wait without spending attempts. FIFO order is retained: an unavailable pinned job at the front also holds later source captures. AI analysis of stored evidence continues in either case.

Chromium connects to a temporary loopback-only CONNECT adapter. The adapter sends credentials solely to the selected upstream proxy; credentials are never passed to Chromium, Meta origin authentication or model inference. Only TLS tunnels to the existing Meta host allowlist on port 443 are permitted, and certificate verification stays enabled. This is transport failover, with no IP rotation to evade access limits, session impersonation, CAPTCHA handling or login/challenge bypass. HTTP 401/403/407/451 and login/checkpoint/challenge redirects stop that capture; already saved evidence is retained.

Missing or invalid required proxy settings appear explicitly in the cloud status. Queued source jobs wait without consuming capture attempts; analysis of already stored images continues independently. After the configuration is completed and Railway redeploys, pending jobs can resume on the next worker tick. Historical blocked jobs are not automatically reset; a normal daily batch or **Bulutta tara** schedules subsequent collection. A configured endpoint is not proof of live Meta access: check actual source outcomes and evidence before reporting successful capture.

The code defaults to direct transport only when neither a mode nor proxy configuration is supplied, for compatibility with existing development environments. A URL or nonempty pool variable alone selects proxy mode. Explicit `AD_CAPTURE_TRANSPORT=direct` is a deliberate operational switch, not a fallback. Production uses explicit proxy mode even before provider details are available.

### Free provider assessment — 2026-09-20

| Source | Free offer verified from the provider | Integration |
| --- | --- | --- |
| [ProxyScrape](https://proxyscrape.com/free-proxy-list) | Public list, no signup; unknown bandwidth and intermittent availability | Five recent HTTP CONNECT candidates imported into Railway's existing pool from the [official HTTPS-capable mirror](https://github.com/ProxyScrape/free-proxy-list/tree/main/proxies/protocols/https). Only public IPv4 addresses and valid ports were admitted. |
| [Webshare](https://www.webshare.io/features/free-proxy) | 10 proxies and 1 GB per month, continuing free tier; account required, no card | Existing pool accepts its individual HTTP proxy endpoints and credentials. No account was created or paid plan purchased. |
| [Oxylabs](https://oxylabs.io/products/free-proxies) | 5 US proxies and 5 GB, free for one month; account required, no card | Trial option only; no account or trial activated. |

The imported public endpoints are a fixed experimental set, not a continuously rotating feed. Provider metadata indicates recent checks, not verified reachability from Railway or successful Meta access. The first production run recorded transport failures on two candidates and no new images; existing evidence remained intact. Public lists can become stale quickly and offer no uptime guarantee. Endpoint values stay in Railway Variables, not the repository. No account credentials, OpenAI requests or application/database traffic are routed through them; the existing browser bridge remains limited to Meta HTTPS destinations with certificate verification.

### Additional verified pages — 2026-09-19

The user supplied these Ad Library page IDs. Their selected advertiser headings were checked on Meta's public Ad Library with **CY / active ads / all ad types**. They map to existing product-provider brands, not duplicate companies.

| Provider | Meta advertiser heading | Facebook page ID |
| --- | --- | --- |
| Nethouse | Nethouse | `159064954156749` |
| Kıbrıs Online | Kibrisonline | `107418628779416` |
| Multimax | Multimax Iletisim Limited | `159594837428220` |
| Broadmax | Broadmax Internet | `546525498748970` |
| FixNet | FixNet Broadband | `1435421553398998` |

Kıbrıs Online's advertiser links to `https://www.facebook.com/kibrisonlineofficial/`; its previous Facebook profile link was corrected. FixNet's selected CY/active filter explicitly showed no matching ads at verification time. This is a point-in-time observation, not evidence of permanent inactivity. The collector recognizes the explicit English/Turkish no-match messages, after checking for access blocks and ad cards. Directory Ad Library links also use CY to match cloud collection.

## Vision connection

Configure the following directly in the Railway app service Variables panel; never put credentials in the repository or chat:

- `OPENAI_API_KEY`: required for visual inference. Without it, cloud capture continues and candidates wait in Postgres; the UI explicitly says the analysis connection is missing.
- `AD_VISION_MODEL`: optional, default `gpt-4.1-mini` (image input and structured output support required).
- `AD_VISION_DAILY_LIMIT`: optional, default 40 external calls per KKTC calendar day, clamped to 1–100. Failed calls count toward the limit.

The worker submits actual JPEG bytes to the OpenAI Responses API with `store:false`, a strict JSON schema, no tools and a bounded response. It does not send credentials, user records or private account pages as model input. Provider response bodies and authorization headers are never logged. Setup errors, refusals, timeouts and rate limits remain explicit failed/pending work; at most three attempts per candidate capture are permitted. The paid-call counter is reserved in Postgres before each request so restarts cannot reset the budget.

Official implementation references: [image inputs](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [model capabilities](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

## Extraction contract and publication

Home internet (`home`), ordinary mobile tariffs (`gsm`) and explicit number portability (`mnp`) remain separate. The AI receives the existing category catalog and may propose a new broad category for other clearly identified advertising, such as devices or events. A new category requires a confidence of at least 0.8 and an exact supporting quote in the transcribed image or caption. Labels are normalized, common synonyms are consolidated, and existing categories are reused. Categories use stable `auto-` keys and are stored transactionally with their first published analysis in `ad_visual_categories`. They immediately become available in archive filters and reports; the home-internet embed remains restricted to `home`. Truly ambiguous creatives remain in `review`, labelled **Diğer / Belirsiz**. This category does not mean the image has not been analyzed.

Each numeric field needs a direct quote containing the value; unsupported values become null. Never add app-restricted Özgür Pass to general GB or multiply a 2X headline into a total. The subscription period and commitment must be visible, not assumed from the price or the duration of an app benefit. A 6+6 message alone is not converted into a verified 12-month contract. Small unreadable text remains an uncertainty. The UI separately shows completed AI analysis, queued reanalysis and remaining uncertain fields.

Taxonomy version 2 also queues historical `review` results for a new AI pass, including results that had exhausted the previous category-only review rounds. The saved screenshots are reused without a new Apify capture. Pending work is not reset, the existing daily inference limit and retry limits apply, and the version marker prevents repeated migration passes. Failed analyses retain their prior published results.

After an initial `review` classification, the worker queues one automatic second AI pass using the original saved screenshots and prior analysis as untrusted context. Device, payment, brand and service ads still receive a substantive AI summary; they are not forced into an unrelated tariff category. Historical reviewed items with evidence but no cloud candidate are also queued. `review_round` prevents repeated automatic passes when the category legitimately remains `review`. New screenshot content resets this per-observation guard. A successful response is saved before publication so an import retry does not purchase another inference.

Category evidence must quote visible text or the caption. If the model instead returns an explanation, the normalizer may recover an exact source sentence supporting that same model-selected category; it never chooses a different category from keywords. Older second passes explicitly rejected only because category evidence was missing can receive one corrective third pass, within the same daily budget. Legitimately other/ambiguous categories do not loop.

The **AI ile yeniden incele** action (`POST /api/ad-visuals/analyze`) can queue a single existing ad, or the current `review` group without a key. It only uses stored evidence, requires existing authentication and same-site JSON requests, has a durable five-minute throttle and uses the existing daily model-call budget. It does not depend on Meta access. Previous results stay visible while a new analysis is pending.

Reanalysis preserves the original capture/observation timestamps. A same-observation update requires matching evidence hashes and a newer AI analysis timestamp; it is recorded as `analysis_updated` in the audit history. Market-change reports exclude this event so an AI correction is not counted as a new competitor campaign change. Cards show the image date and AI analysis date separately.

Each completed analysis passes the existing `validateAdFeed` contract with producer `cloud-vision`, then uses a transactional one-ad import. Evidence is already in Postgres; no GitHub asset download is involved. Capturing and analyzing are separate timestamps. Failed or absent observations never deactivate previous ads, and this output does not change product catalogs or CPE scores. The UI exposes source status, captured counts, pending/analyzed counts, heartbeat and missing connection state independently from the last successful analysis.

Existing `chatgpt-browser-visual` manifests remain readable for historical maintenance, but the production server no longer polls or imports the old GitHub feed. `/api/ad-visuals/sync` returns a migration message in cloud mode; all new work uses `/api/ad-visuals/scan`.

## Verification and operation

### Illustrated email and PDF reports

Daily, weekly, monthly, home internet, FWA and Telsim reports reuse their period's archived ad evidence. Explicit creative images take priority; an older browser card/creative pair is accepted only when its exact hashes and capture provenance match. Only uniform outer whitespace is trimmed, with a safety margin. Images retain their aspect ratio and offer text; the original evidence is unchanged. Each derived JPEG is at most 150 KB and 960 × 1280 pixels, without enlargement. Up to 24 illustrated records are distributed across categories, with remaining records shown as text and sampling counts disclosed.

PDFs embed JPEG bytes. HTML emails use immutable HTTPS images from `/report-media/<sha256>.jpg`, compatible with both existing mail transports. Only proven public creatives are published there; unverified full-page/card evidence stays in the authenticated archive and embedded PDF. Missing, corrupt or unpublishable images retain the analysis and source link. Public image URLs expose no analysis, account information or archive metadata.

PDF output uses A4 margins, 10.5 pt body text, at least 9 pt table text, repeated table headers and numbered page footers. Long ad details continue outside the unbroken creative card. `node test/report-layout.mjs` renders all report families and illustrated email layouts at 700 px and 390 px into `test-output/report-layout`; CI uploads the PDFs and page PNGs for visual review. This check does not send email or call paid capture/AI services.

Added/removed package snapshots in PDF change tables are formatted as readable product summaries. Raw JSON, crawler metadata and full scraped page text remain in the stored record instead of expanding narrow report cells across pages. Scalar field changes retain their before/after values, including zero; full package prices and effective monthly prices are labeled separately.

`node --test test/ad-capture-proxy.test.js test/ad-proxy-*.test.js test/ad-cloud*.test.js test/ad-provider-handoff.test.js test/ad-provider-worker.test.js test/ad-visual.test.js` exercises local synthetic CONNECT proxies and real database transactions with isolated evidence. Tests cover daily scheduling across summer/winter local times, catch-up, more than seven verified pages, shared-page deduplication, provider handoff, failover, sticky retries, preserved evidence, persisted cooldowns and continued AI work during transport waits. CI also checks desktop/mobile views. No production proxy or model key is needed for tests. Unit tests validate the transport and API request contracts but do not prove a particular live provider can access Meta or a model; successful production capture and inference must be verified separately after configuration.

Logs `[ad-cloud-capture]` report source outcome, safe HTTP/reason codes, captured count and retry time. `[ad-cloud-source-status]` reports existing source outcomes once per worker start without provider response bodies. `[ad-cloud-review]` reports queued second passes; `[ad-cloud-worker]` includes analyzed brand, category, pass, candidate counts and daily calls. It never labels a missing-key run successful. Confirm the deployment commit, worker logs, source outcomes and an actually analyzed candidate before claiming end-to-end operation. A server-side Meta block may still require a separately authorized data source; do not bypass it.

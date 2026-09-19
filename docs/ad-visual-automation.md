# Markets Pulse cloud advertising analysis

## Runtime and schedule

The Railway application runs the producer itself. No ChatGPT task, personal browser session, GitHub feed or open user tab is required. The legacy ChatGPT producer is retired; do not publish new scheduled observations to `ad-visual-data`. Existing analyzed records and evidence remain in Postgres.

Every minute the server worker checks its durable queue. At or after 06:00 Asia/Famagusta it schedules one daily batch (catching up after downtime), containing Telsim and six least-recently-queued competitors. `ad_cloud_control.scheduled_day` prevents duplicate daily scheduling across restarts. A database lease serializes workers across replicas. Interrupted source jobs retry at most three times; completed screenshots survive every retry. Manual scans use the same queue, coalesce active brand jobs and have a durable five-minute throttle.

The **Bulutta tara** button queues work and returns immediately. The user can close the page. **Sonuçları yenile** reads the current state without scheduling another job or disrupting expanded cards automatically.

Newly verified numeric pages receive one initial source job on the next worker tick, even when the daily batch has already been scheduled. Historical jobs without that page ID do not suppress registration. The worker lease and durable source batch key prevent repeated registration on restart; normal rotation applies afterward. This does not reset or increase the daily model-call budget.

## Capture and identity

`src/ad-cloud-capture.js` launches headless Chromium in Railway and reads public rendered Ad Library cards. Only registry-verified numeric Facebook page IDs are scanned. A known profile URL or similarly named keyword result is not enough to assign advertiser identity; unresolved brands are recorded as unverified. CY is the recorded country filter. Each source run saves up to 12 visible ad cards, with the card identity and a separate creative screenshot when available. This bounded scan is partial coverage, not a count of all active campaigns or all variants.

The collector uses normal public page navigation with no login credentials, private GraphQL requests, stealth plugins, proxy rotation or challenge bypass. A real cookie consent option may be clicked; login/challenge overlays are never removed. Access failures and DOM parsing failures are not interpreted as zero ads. Loaded video frames with real dimensions can be captured even when there is no separate image element. Video analysis covers only the captured frame. Entire video playback and carousel traversal are not implemented.

HTTP 429 is a temporary source rate limit. Respect `Retry-After` with a 15-minute minimum (24-hour cap), pause all source collection until that time, and retry the source at most three times. Stored-image AI analysis continues during the pause. Historical HTTP 429 jobs from the last two days may resume after the same cooldown; HTTP 403 and challenge/access restrictions remain blocked and are not automatically retried by this recovery logic. Do not claim these restrictions are fixed by adding an OpenAI key or by retry scheduling.

Every screenshot is SHA-256 checked and saved directly to `ad_visual_evidence` before model inference. `ad_cloud_candidates` stores the evidence references, advertiser/ad identity, caption and actual capture time in the same transaction. Captured but unanalyzed cards do not appear as completed analyses. Old validated cards are never removed just because a scan fails or misses them.

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

Home internet (`home`), ordinary mobile tariffs (`gsm`) and explicit number portability (`mnp`) remain separate. Other or ambiguous creatives enter `review`, labelled **Diğer / Belirsiz**. This category does not mean the image has not been analyzed. Each numeric field needs a direct quote containing the value; unsupported values become null. Never add app-restricted Özgür Pass to general GB or multiply a 2X headline into a total. The subscription period and commitment must be visible, not assumed from the price or the duration of an app benefit. A 6+6 message alone is not converted into a verified 12-month contract. Small unreadable text remains an uncertainty. The UI separately shows completed AI analysis, queued reanalysis and remaining uncertain fields.

After an initial `review` classification, the worker queues one automatic second AI pass using the original saved screenshots and prior analysis as untrusted context. Device, payment, brand and service ads still receive a substantive AI summary; they are not forced into an unrelated tariff category. Historical reviewed items with evidence but no cloud candidate are also queued. `review_round` prevents repeated automatic passes when the category legitimately remains `review`. New screenshot content resets this per-observation guard. A successful response is saved before publication so an import retry does not purchase another inference.

Category evidence must quote visible text or the caption. If the model instead returns an explanation, the normalizer may recover an exact source sentence supporting that same model-selected category; it never chooses a different category from keywords. Older second passes explicitly rejected only because category evidence was missing can receive one corrective third pass, within the same daily budget. Legitimately other/ambiguous categories do not loop.

The **AI ile yeniden incele** action (`POST /api/ad-visuals/analyze`) can queue a single existing ad, or the current `review` group without a key. It only uses stored evidence, requires existing authentication and same-site JSON requests, has a durable five-minute throttle and uses the existing daily model-call budget. It does not depend on Meta access. Previous results stay visible while a new analysis is pending.

Reanalysis preserves the original capture/observation timestamps. A same-observation update requires matching evidence hashes and a newer AI analysis timestamp; it is recorded as `analysis_updated` in the audit history. Market-change reports exclude this event so an AI correction is not counted as a new competitor campaign change. Cards show the image date and AI analysis date separately.

Each completed analysis passes the existing `validateAdFeed` contract with producer `cloud-vision`, then uses a transactional one-ad import. Evidence is already in Postgres; no GitHub asset download is involved. Capturing and analyzing are separate timestamps. Failed or absent observations never deactivate previous ads, and this output does not change product catalogs or CPE scores. The UI exposes source status, captured counts, pending/analyzed counts, heartbeat and missing connection state independently from the last successful analysis.

Existing `chatgpt-browser-visual` manifests remain readable for historical maintenance, but the production server no longer polls or imports the old GitHub feed. `/api/ad-visuals/sync` returns a migration message in cloud mode; all new work uses `/api/ad-visuals/scan`.

## Verification and operation

`node --test test/ad-cloud.test.js test/ad-visual.test.js` exercises real database transactions with synthetic isolated evidence. CI also checks desktop/mobile views. No production model key is needed for tests. Unit tests validate the API request contract but do not prove a particular live account has model access; a successful production inference must be verified after configuring the key.

Logs `[ad-cloud-capture]` report source outcome, safe HTTP/reason codes, captured count and retry time. `[ad-cloud-source-status]` reports existing source outcomes once per worker start without provider response bodies. `[ad-cloud-review]` reports queued second passes; `[ad-cloud-worker]` includes analyzed brand, category, pass, candidate counts and daily calls. It never labels a missing-key run successful. Confirm the deployment commit, worker logs, source outcomes and an actually analyzed candidate before claiming end-to-end operation. A server-side Meta block may still require a separately authorized data source; do not bypass it.

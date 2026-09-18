# Markets Pulse cloud advertising analysis

## Runtime and schedule

The Railway application runs the producer itself. No ChatGPT task, personal browser session, GitHub feed or open user tab is required. The legacy ChatGPT producer is retired; do not publish new scheduled observations to `ad-visual-data`. Existing analyzed records and evidence remain in Postgres.

Every minute the server worker checks its durable queue. At or after 06:00 Asia/Famagusta it schedules one daily batch (catching up after downtime), containing Telsim and six least-recently-queued competitors. `ad_cloud_control.scheduled_day` prevents duplicate daily scheduling across restarts. A database lease serializes workers across replicas. Interrupted source jobs retry at most three times; completed screenshots survive every retry. Manual scans use the same queue, coalesce active brand jobs and have a durable five-minute throttle.

The **Bulutta tara** button queues work and returns immediately. The user can close the page. **Sonuçları yenile** reads the current state without scheduling another job or disrupting expanded cards automatically.

## Capture and identity

`src/ad-cloud-capture.js` launches headless Chromium in Railway and reads public rendered Ad Library cards. Only registry-verified numeric Facebook page IDs are scanned. A known profile URL or similarly named keyword result is not enough to assign advertiser identity; unresolved brands are recorded as unverified. CY is the recorded country filter. Each source run saves up to 12 visible ad cards, with the card identity and a separate creative screenshot when available. This bounded scan is partial coverage, not a count of all active campaigns or all variants.

The collector uses normal public page navigation with no login credentials, private GraphQL requests, stealth plugins, proxy rotation or challenge bypass. A real cookie consent option may be clicked; login/challenge overlays are never removed. Access failures and DOM parsing failures are not interpreted as zero ads. Video analysis covers only the captured frame. Entire video playback and carousel traversal are not implemented.

Every screenshot is SHA-256 checked and saved directly to `ad_visual_evidence` before model inference. `ad_cloud_candidates` stores the evidence references, advertiser/ad identity, caption and actual capture time in the same transaction. Captured but unanalyzed cards do not appear as completed analyses. Old validated cards are never removed just because a scan fails or misses them.

## Vision connection

Configure the following directly in the Railway app service Variables panel; never put credentials in the repository or chat:

- `OPENAI_API_KEY`: required for visual inference. Without it, cloud capture continues and candidates wait in Postgres; the UI explicitly says the analysis connection is missing.
- `AD_VISION_MODEL`: optional, default `gpt-4.1-mini` (image input and structured output support required).
- `AD_VISION_DAILY_LIMIT`: optional, default 40 external calls per KKTC calendar day, clamped to 1–100. Failed calls count toward the limit.

The worker submits actual JPEG bytes to the OpenAI Responses API with `store:false`, a strict JSON schema, no tools and a bounded response. It does not send credentials, user records or private account pages as model input. Provider response bodies and authorization headers are never logged. Setup errors, refusals, timeouts and rate limits remain explicit failed/pending work; at most three attempts per candidate capture are permitted. The paid-call counter is reserved in Postgres before each request so restarts cannot reset the budget.

Official implementation references: [image inputs](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [model capabilities](https://developers.openai.com/api/docs/models/gpt-4.1-mini).

## Extraction contract and publication

Home internet (`home`), ordinary mobile tariffs (`gsm`) and explicit number portability (`mnp`) remain separate. Unclear or out-of-scope creatives enter `review`. Each numeric field needs a direct quote containing the value; unsupported values become null. Never add app-restricted Özgür Pass to general GB or multiply a 2X headline into a total. The subscription period and commitment must be visible, not assumed from the price or the duration of an app benefit. A 6+6 message alone is not converted into a verified 12-month contract. Small unreadable text remains an uncertainty. All machine-produced analyses retain condition-verification flags.

Each completed analysis passes the existing `validateAdFeed` contract with producer `cloud-vision`, then uses a transactional one-ad import. Evidence is already in Postgres; no GitHub asset download is involved. Capturing and analyzing are separate timestamps. Failed or absent observations never deactivate previous ads, and this output does not change product catalogs or CPE scores. The UI exposes source status, captured counts, pending/analyzed counts, heartbeat and missing connection state independently from the last successful analysis.

Existing `chatgpt-browser-visual` manifests remain readable for historical maintenance, but the production server no longer polls or imports the old GitHub feed. `/api/ad-visuals/sync` returns a migration message in cloud mode; all new work uses `/api/ad-visuals/scan`.

## Verification and operation

`node --test test/ad-cloud.test.js test/ad-visual.test.js` exercises real database transactions with synthetic isolated evidence. CI also checks desktop/mobile views. No production model key is needed for tests. Unit tests validate the API request contract but do not prove a particular live account has model access; a successful production inference must be verified after configuring the key.

Logs `[ad-cloud-capture]` report source outcome and captured count. `[ad-cloud-worker]` reports cloud mode, vision configuration, candidate counts and daily calls; it never labels a missing-key run successful. Confirm the deployment commit, worker logs, source outcomes and an actually analyzed candidate before claiming end-to-end operation. A server-side Meta block may still require a separately authorized data source; do not bypass it.

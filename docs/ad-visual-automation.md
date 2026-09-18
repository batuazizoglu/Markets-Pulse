# Markets Pulse scheduled visual advertising analysis

The producer is a ChatGPT scheduled browser review. The application does not have a vision API key and does not run an independent Meta scraper. It imports the validated public evidence feed every 15 minutes and on startup. Pausing/deleting the ChatGPT task pauses new reviews; the app marks observations older than 48 hours stale. This architecture must remain explicit.

## Scope and interpretation

- Three mutually exclusive product groups: home (fixed home broadband, Superbox/Red Box), gsm (ordinary mobile tariffs), mnp (mobile number portability).
- Classify by explicit visible evidence. A mobile promotion without a visible portability condition is not MNP. Devices-only ads are outside scope; unresolved mixed/illegible product offers go to review.
- Review Telsim every run. Also review at least six least-recently-checked competitors from src/isp-registry.js, prioritizing verified official social pages. Rotate to cover all listed competitors; unknown official accounts must be recorded as unverified, never replaced by a same-name advertiser.
- Telsim verified Page ID: 164143610515. Use the user's CY country filter and record it. Official page: https://www.facebook.com/kktctelsim .
- For other brands corroborate the advertiser with its official website/profile before adding a page ID. Ad Library keyword results alone do not establish advertiser identity.
- Observe up to 40 relevant ads per run, prioritizing new/changed offers. Report partial coverage if any cap, pagination, video, variants or blocked access prevents full inspection.
- Inspect the actual advertising images with the supported browser skill, not only captions/search snippets. Enlarge cards and inspect fine print when legible. For video, state that only the observed frame was analyzed; do not claim full video review.
- No guessed prices, expiry dates, plan periods, taxes, commitments or automatic arithmetic from 2X/bonus headlines. Separate base GB, bonus GB, current and crossed-out price. Unread values are null plus uncertainties. Preserve tariff-add-on, age, region and new-customer/MNP conditions.
- This output never changes official product catalogs, CPE scores or automatic matching.
- Seeing an ad for the first time is an observation, not proof of launch. Do not mark ads inactive because they disappeared from a partial or failed scan. Only explicit inactive evidence supports inactive.
- Never submit forms, buy products, contact people or use credentials outside supported authentication. On access failure record the failure and keep prior analyses.

## Authorized publication

User authorized regular publication into Markets Pulse and standing deployment permission. This producer may update ONLY branch ad-visual-data of batuazizoglu/Markets-Pulse. Never change main, application code, secrets, configuration, users or emails. The data branch contains publicly visible advertising evidence only and does not trigger main deployments.

1. Read this document and src/ad-visual.js from main using the GitHub plugin.
2. Read latest.json and the branch head of ad-visual-data. Preserve all existing ads and per-brand coverage entries that were not reviewed, including their original timestamps. Refresh only observations actually made in this run. Retain at most 400 recent ads (90 days); the application's database keeps prior versions.
3. Read the browser skill and use its supported runtime. Follow public lookup, authentication and block-handling instructions. Do not work around login/bot controls.
4. Save the exact inspected JPEG screenshot bytes through the browser skill shared-file mechanism. The image should contain the enlarged creative and its ad identity when possible. Up to three images per ad; each below 1.5 MB. Compute SHA-256 on the saved bytes. Use evidence/<sha256>.jpg. Never manufacture or re-render a creative as evidence.
5. Publish screenshots with GitHub create_blob(base64) and a tree entry using its blob SHA. These are repository-backed assets, not separate Library deliverables. Do not emit base64 in chat.
6. Publish a checkpoint after the first completed category or every 2–4 reviewed ads, before moving to the next group/brand. Each checkpoint is one atomic GitHub commit containing its evidence and cumulative latest.json; do not wait until the entire multi-brand review finishes. Use a unique run.id and actual checked_at for every checkpoint and partial status until intended coverage is complete. Advance the existing branch without force. If the branch head changes concurrently, reread and merge observations by (page_id, ad_id, variant_id) using the newest observed_at. Use literal content in structured GitHub arguments. No credentials are needed for the application's read-only feed.
7. After writing, fetch latest.json back and verify run.id and expected keys. Report only verified updates/blockers in Turkish, with the live #ads link. The application imports within 15 minutes; don't claim import completion without evidence.

Preserve exact analysis fields and wording for an unchanged offer. Update observed_at but retain the old evidence capture date if reusing identical existing evidence. A new screenshot or wording alone is not a market event. New variants get distinct variant_id.

## latest.json version 1

Top-level:
- schema_version: 1
- producer: "chatgpt-browser-visual"
- schedule: {enabled: true, description: "Her sabah; Telsim günlük, diğer rakipler dönüşümlü", timezone: "Asia/Famagusta"}
- run: {id: unique safe ASCII string 8–100 chars, checked_at: ISO timestamp, status: "ok"|"partial"|"blocked"|"error", coverage: [...]}
- ads: cumulative array, max 400

Coverage:
{brand, source_url, country: "CY"|"TR"|"ALL", status: "ok"|"partial"|"blocked"|"error"|"unverified"|"no_ads", checked_at: ISO timestamp, reviewed_ads: integer|null, note}
Use current time only for sources actually attempted. "no_ads" requires explicit empty results for a verified page/filter. An approximate result heading is not an exact campaign count. "ok" for a run requires complete intended coverage; otherwise use partial/blocked/error.

Each ad must have:
- ad_id and page_id: observed decimal strings (5–30 digits); brand: exact registry brand (or KKTCELL)
- variant_id: stable ASCII letters/digits/underscore/dash; default "1"
- category: home|gsm|mnp|review
- category_evidence: visible offer/caption evidence supporting the category
- title: concise exact offer name
- source_url: observed HTTPS facebook.com/instagram.com URL, no credentials; use the actual inspected Ad Library page URL
- ad_status: active|inactive|unknown; started_on: YYYY-MM-DD|null
- observed_at: ISO timestamp no later than run.checked_at
- ad_text: visible advertising caption
- offer: {price_try, previous_price_try, data_gb, bonus_data_gb, minutes, speed_mbps, commitment_months, billing_period}
  All numeric keys are required, finite non-negative numbers or null.
  billing_period: monthly|one_time|unknown. Do not infer a monthly period from the brand/price alone.
- conditions: array of observed conditions (max 20)
- uncertainties: array of missing/illegible/ambiguous details (max 20)
- visual_summary: concise assessment of the layout/message, labeled as interpretation when necessary
- review_required: boolean
- images: [{sha256: 64 lowercase hex, path: "evidence/<same-sha256>.jpg", captured_at: ISO timestamp}]
  At least one real inspected screenshot required. Do not add an ad without evidence.
- No internal/authenticated account data, cookies, tokens, personal profiles or analyst conversation content.

A blocked run can publish ads unchanged plus updated coverage/run status. It must never publish invented observations. The app validates the entire feed, screenshot hashes and bounded downloads before a transaction; a failed batch leaves previous observations untouched.

## Recovering an interrupted review

Persist an inspected image as soon as it is captured and publish each completed checkpoint immediately. If the browser runtime disconnects, retain all published checkpoints and resume from the last confirmed run. Do not replace successful results with an empty setup/error seed. If the task ends early, keep its partial coverage and report which brands/ads remain unreviewed. A future run reads the published checkpoint before resuming.

The application button **Yeni analizleri aktar** fetches the latest published results immediately; it does not launch a browser review. It is authenticated, same-origin and rate-limited to one request per minute. Runtime sync logs include actual database category/evidence counts so an import can be verified without exposing credentials.

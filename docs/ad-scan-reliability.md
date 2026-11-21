# Daily ad coverage and current-list verification

Positive outputs from `apify/facebook-ads-scraper` may contain ad rows without
`totalCount` or `isResultComplete`. A successfully exhausted dataset is evidence
of transport completion, not proof of complete Meta source coverage. The actor's
[count-only mode](https://apify.com/apify/facebook-ads-scraper/input-schema) provides
an independent source total for the same verified page and filters.

## Completion contract

- Validate numeric advertiser/ad identities, active status, source filters and
  all returned creatives. Failed or rejected rows and capped runs remain partial.
- Accept an exact source summary total, or an explicit page-wide complete summary.
  A per-ad completion flag alone cannot certify the source.
- If a positive dataset lacks confirmation, reserve one count-only call within
  the existing per-page cap. The creative allowance plus count allowance never
  exceeds that cap; the daily reservation is not increased.
- Save the count creation fence before POST. Save the accepted run/dataset IDs
  and poll or read them on later ticks. Restarts and read retries do not POST again.
- Reject counts from running, failed, truncated, minimum-count, differently
  filtered, wrong-page or unconfirmed-budget results. Distinct active ad IDs must
  equal the confirmed total before absence-based retirement is allowed.
- Count checks can retry bounded reads for up to the original scan's two-hour
  verification window. An ambiguous count start leaves the scan partial. There
  is no automatic replacement POST for the same scan.

The comparison is against the provider's selected page and active/CY filters at
observation time, not a claim that every live Meta ad has been independently
verified. A count mismatch or incomplete source never means “no ads.”

## Current and archived ads

The database lifecycle policy retains its default `Asia/Famagusta` timezone,
daily hour and 30-hour active window. This change does not overwrite that policy.
Current cards need an explicit active observation within the configured window,
at or after the latest finished provider check for their page. Older evidence
can remain current when the same ad was freshly verified.

An unseen ad after a partial or failed check is archived as “Son taramada
doğrulanmadı”; its historical active observation is preserved. Only complete
checks may record missing ads as inactive. Explicit inactive/unknown observations,
expired confirmations and superseded creatives remain outside the current view.
Pending media and source counts use the same cutoff.

`list_matches_latest_scan` compares distinct published ad IDs across categories
and variants with the most recent fully complete, fresh source result. Equal
counts with different IDs do not match. Partial/stale checks and newer queued
checks return an unverified value. AI publication may lag capture; a complete
capture does not imply every captured ad already has a published analysis.

## Missing daily checks and ambiguous old starts

The source registry defines the expected page inventory, deduplicating shared
aliases such as KKTCELL / Turkcell Ev İnterneti. Missing and stale sources remain
in coverage. A missing scan has no invented check timestamp.

For an old ambiguous detail-run start, bounded read-only lookup must finish
without conflicting or truncated results. An exact match resumes the original
run. An exhaustive no-match permits a separately budgeted daily check only on a
later policy-local date and after a two-hour safety window. The original run,
reservation and evidence stay intact. Only unstarted, superseded daily tickets
are skipped; manual or same-day retries remain fenced.

## Rollout verification

Schema changes are additive provider columns plus replacement lifecycle views.
No historical ad/evidence rows are deleted and no policy values are rewritten.
Use the normal application migration and deployment process after approval.

After rollout, check the authenticated ad API and `[ad-scan-audit]` logs:

1. All 10 currently verified advertiser pages are represented, including Xrealnet.
2. Confirm the actual database timezone, scan hour and active window from the audit.
3. Every required page is fresh and complete, or has an explicit partial, blocked,
   failed, pending or missing state with its reason.
4. KKTCELL and other complete sources have `list_matches_latest_scan=true` after
   AI publication. A false or null comparison must remain visible as unverified.
5. Current rows exclude inactive/unverified/expired observations and archive
   contains the complementary rows with the correct reason.
6. Count retries reuse saved IDs and reservations; the old ambiguous job is not
   restarted or charged as a replacement.

The audit logs only changes to the snapshot, avoiding a repeated per-minute
source dump. It includes no tokens, signed media URLs or user data.

## Verification (21 November 2026)

- Node 24.22.3: full automated suite, 545/545 passed. The final audit alias and
  inconsistent-status checks also passed after the full run.
- All source and browser JavaScript syntax checks and `git diff --check` passed.
- `npm pack --dry-run` passed. This repository defines no separate lint or build
  script.
- An isolated PGlite database initialized with the current `main` schema upgraded
  successfully twice, preserving the lifecycle policy, observations, reserved
  budget and ambiguous source job.
- The Chromium layout runner was attempted but could not launch because this
  execution environment denied its socket creation (`Operation not permitted`).
  The DOM/UI tests passed; real browser layout verification remains a CI check.
- No live provider calls, production database writes, service changes or
  deployments were made during this verification.

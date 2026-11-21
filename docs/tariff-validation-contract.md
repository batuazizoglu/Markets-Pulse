# GSM tariff extraction contract

`telsim-dom-v1` validates the three configured KKTC Telsim tariff pages before
publishing any catalogue changes. Its scope is the existing parser's supported
GSM card shapes, not every offer on the website.

## Publication rules

- The requested and final response URL must match the configured source, and
  the received HTML must include its document closing tags.
- Physical `div.shadow-full` cards, main quota fields, headline price fields and
  detail controls must form a one-to-one inventory. Missing selectors on one
  card fail the source, even when other cards remain readable.
- Each supported card is parsed in isolation. Its parsed name, quota and price
  must agree with its own DOM fields. Phase prices remain separate from the
  headline price; a large genuine price increase is not rejected by a threshold.
- The whole-page text parser and isolated-card parser must produce the same
  multiset of supported observations. This catches a card whose styling markers
  have all disappeared, and any remaining cross-card contamination.
- Unknown layouts, missing fields, conflicting prices/quotas/SMS values and
  tracked tariffs changing into an unsupported shape stop publication. No
  product/version/change or missing counter is updated. The failed scan retains
  a response fingerprint and a `TARIFF_CONTRACT_ERROR` reason in source health.
- Accepted product versions, events, missing counters and successful scan status
  commit atomically. A later database error rolls them all back. Screenshot
  failures remain evidence warnings and do not invalidate a committed scan.
- A package removal still requires two successful observations without it.
  Rejected scans never count as absence evidence.
- If previously separate tracked variants collapse to an identical value/hash,
  duplicate removal is rejected for review instead of declaring one offer gone.
  Repeated markup for an already single tracked offer remains valid.

All fields end at the exact detail or purchase control. Legacy spill correction
requires the original raw observation to prove the boundary and the recorded
values. It does not delete or rewrite historical observations. Genuine concurrent
price and condition changes continue through the normal timeline/email path.

## Explicit coverage and remaining identity limitations

A read-only source replay on 2026-11-21 produced:

| Source | Physical cards | Supported cards before deduplication | Explicit exclusions |
| --- | ---: | ---: | ---: |
| Faturalı | 28 | 28 | 0 |
| Faturasız | 31 | 29 | 2 |
| Diğer Faturalı | 177 | 167 | 10 |

Exclusions preserve existing monitoring scope: no-data Askerfone packages, MB
allowances, multiple allowance choices, combined main/bonus quota headings and
unlimited Red Box. They are returned in scan diagnostics and saved with snapshot
validation metadata. These counts must not be described as complete coverage of
all website offers. A previously tracked identity entering an excluded shape is
rejected instead of becoming an apparent removal.

Numeric Red Box cards still use the existing body-derived identity
`12 Ay Tarifeye Ek`. The validation guard protects that legacy identity when a
numeric Red Box card becomes excluded, while allowing the already-untracked
`Red Box Sınırsız` to coexist. This patch does not migrate historical identities.
Likewise, two acquisition channels can contain the same product name. Keeping
both parsed cards does not establish a stable channel identity. A future identity
upgrade needs source + acquisition section + offer identity, original evidence
for migration, and rejection of ambiguous historical matches; price must not be
the identity key.

The contract can detect partial extraction within received HTML. It cannot prove
that a vendor response omitted a whole card with no remaining structural marker,
or that the vendor's own published values are correct. The two-observation removal
rule remains in force; an unfamiliar format must be investigated rather than
added to the exclusions merely to make a scan green.

## Validation and maintenance

Run `npm test`, plus source syntax checks and `git diff --check`. Focused coverage
is in `tariff-contract.test.js`, `tariff-scan-validation.test.js`,
`tariff-card-boundaries.test.js`, `tariff-card-recovery.test.js`, and
`competitive-changes.test.js`.

For a layout change, first capture the official HTML, inspect the actual card
boundaries, and reproduce the failure offline. Update the versioned contract
with representative cases for supported and excluded shapes. Replay all three
sources, compare observation hashes, and test that genuine simultaneous changes
survive any evidence-based baseline repair. Never clear validation failures by
editing production history or by bypassing the publication gate.

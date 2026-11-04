# Home internet delivery investigation — 4 November 2026

Reported symptom: newly created standard users can open the application, but the
home internet view displays `Failed to fetch` and no catalog/history.

## Evidence and limits

- Railway's application and Postgres services were online on deployment
  `697ea91f-6d15-4d0b-900d-d492e786e415` (PR 48).
- The 20 recorded `/api/home-internet` requests between 06:51 and 09:59 UTC
  returned HTTP 200. Most took 251–1,115 ms; one took 45,730 ms.
- There was no recorded 401/403 on this endpoint in that window. These logs do
  not identify the complainants or prove their browsers received the whole body.
- The browser displayed the native Fetch network exception, not the application's
  HTTP permission-error message. The exact client/network cause has not been
  reproduced on either affected user's device.
- The catalog is shared; no account-created-at filter exists. Real authentication
  tests below verify that a new account can read data collected before it existed.

## Change

- The browser requests `view=browser` on the same authenticated endpoint. It
  receives the full products, history, sources, metrics and social information,
  without redundant precomputed catalog arrays that this view does not consume.
  The default API response remains compatible with existing consumers.
- Gzip is negotiated for catalog responses of at least 1 KiB. Clients that reject
  gzip retain plain JSON. `Vary: Accept-Encoding` and private/no-store are set.
- A read interrupted by a network failure or timeout retries once after 750 ms.
  Read requests time out after 20 seconds; manual collection allows 180 seconds.
  Authentication/permission errors, rate limits and manual collection do not retry.
- A superseded request is cancelled. Existing data is retained after a failed
  refresh, and a readable Turkish message replaces the raw browser exception.
- Server delivery logs contain role, counts, encoding and byte sizes only—no
  identities, cookies, secrets or catalog contents.

## Validation

- A local PGlite database contains 860 offers collected before two test accounts
  were created. The real login/session/password-change middleware and production
  home endpoint return identical products to the standard and admin accounts.
- Unauthenticated reads return 401; first-login password change is enforced with
  428; standard forced collection still returns 403.
- The 860-offer test transfers 1,186,795 bytes with the old full identity response,
  versus about 33,666 bytes for the compact gzipped response (about 97% less).
  This is a controlled fixture measurement, not a production transfer measurement.
- Tests cover response integrity, gzip refusal, failed body reads, retry success,
  persistent failure, stalled requests, and the no-retry authorization boundaries.
- Existing history tests verify that all 7/30/90-day records remain available.

After deployment, refresh the affected browsers to load the updated script and
confirm recovery. If the symptom persists, the browser network failure details
and company-network versus independent-network comparison are still needed.

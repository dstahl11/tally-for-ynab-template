# Operations guide

## Recommended layout

- Project: `/opt/tally-for-ynab`
- Container: `ynab-companion`
- Persistent volume: `ynab-companion-data`
- App port: host `3030`; restrict it to a trusted network or reverse proxy.

The base profile is safe for mock testing. The `live` profile adds Cloudflare
Tunnel and Litestream only after their credentials are present.

## Before connecting real accounts

1. Copy `.env.example` to `.env` and replace every placeholder.
2. Set `MOCK_EXTERNALS=false` but keep `DRY_RUN=true`.
3. Start the app and confirm `/health` is green.
4. Run a cold sync for the configured history window.
5. Confirm the exact unapproved transaction count reconciles with YNAB.
6. Verify admin and member scopes with non-sensitive test transactions.
7. If using SMS, verify consent, STOP/HELP handling, rate limits, link expiry,
   and your applicable carrier registration before inviting users.

## Seven-day dry-run soak

For seven consecutive days, review:

- every sync reconciles exactly;
- no downstream work runs after a forced mismatch;
- proposed routing, approval, funding, and target writes match their reversal
  hints;
- no member response contains an out-of-scope category or transaction;
- the write log contains only `dry_run=true` entries.

Do not set `DRY_RUN=false` until this checklist and a restore drill pass.

## Restore drill

1. Stop only the app container; do not remove its volume.
2. Restore the latest replica into a separate scratch path or volume.
3. Run `PRAGMA integrity_check;` and row counts for transactions, settings,
   proposals, and `write_log`.
4. Start a temporary app instance against the restored copy and verify
   `/health`, dashboard queries, and the last reconciliation timestamp.
5. Remove only the scratch restore after verification, then restart the
   original app against its untouched volume.

## Routine checks

```sh
docker ps --filter name=ynab-companion
docker logs --tail 100 ynab-companion
curl -fsS http://127.0.0.1:3030/health
```

Never remove the persistent volume during an update or rollback.

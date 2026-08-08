# Tally for YNAB

A self-hosted, white-label companion for a two-person YNAB household. It adds
verified sync, scoped member access, transaction categorization, funding
proposals, budget pace, charts, and read-only AI-assisted questions.

This repository contains only mock data and placeholders. It is safe to run
without YNAB, Anthropic, or Twilio credentials.

## Try it locally

Requirements: Node.js 22+, npm, and optionally Docker.

```sh
cp .env.example .env
npm ci
npm run dev
```

Open `http://localhost:5173`. The example admin PIN is unset by default; either
add six-digit `ADMIN_PIN` and `MEMBER_PIN` values or use `/auth/mock/admin` and
`/auth/mock/member` while `MOCK_EXTERNALS=true`.

## White-label it

1. Edit `web/brand.config.ts` for the app name, tagline, operator, contact email,
   and policy effective date.
2. Replace the files in `web/public/brand/` with your own SVG and PNG assets.
3. Set `APP_NAME`, `ADMIN_NAME`, and `MEMBER_NAME` in `.env`.
4. Adjust `config/essentials.json` and `config/thresholds.json` for your budget.
5. Replace the example color tokens at the top of `web/src/styles.css` if wanted.

The source uses generic `admin` and `member` IDs. Names and phone numbers live
only in the ignored `.env` file.

## Connect real services

Keep both safety switches on until the complete dry-run checklist passes:

```env
DRY_RUN=true
MOCK_EXTERNALS=false
```

Then provide:

- a YNAB personal access token and budget ID;
- Anthropic API credentials for AI inference;
- Twilio credentials if you want SMS sign-in or notifications;
- the member's YNAB account, category-group, and optional category IDs;
- a random session secret of at least 32 characters.

Never commit `.env`, databases, backup credentials, phone numbers, PINs, or
tunnel tokens. SMS registration, consent language, privacy terms, and carrier
requirements are the deployer's responsibility.

## Validate

```sh
npm test
npm run build
docker compose config
```

## Docker

```sh
cp .env.example .env
docker compose up --build -d
```

The app listens on host port `3030`. Optional Cloudflare Tunnel and Litestream
services are in the `live` profile and require your own protected credentials.
See `docs/OPERATIONS.md` before enabling writes.

## Safety model

- `DRY_RUN=true` logs proposed YNAB writes without applying them.
- Mock mode cannot be combined with live writes.
- Sync reconciliation pauses downstream jobs when local and YNAB unapproved
  transaction counts disagree.
- Member access is scoped to configured YNAB accounts and categories.
- Magic links expire after 15 minutes, work once, and are rate-limited.
- Five failed PIN attempts lock that profile for 15 minutes.

## License

MIT. Tally is an independent companion and is not endorsed by or affiliated
with YNAB.

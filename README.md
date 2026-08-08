<p align="center">
  <img src="web/public/brand/icon-256.png" width="112" alt="Tally calculator icon">
</p>

<h1 align="center">Tally for YNAB</h1>

<p align="center">
  <strong>A calmer, more focused way to understand and maintain a household budget.</strong>
  <br>
  Personalized category status, AI-assisted cleanup, and answers you can explore.
</p>

<p align="center">
  <a href="https://github.com/dstahl11/tally-for-ynab-template/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/dstahl11/tally-for-ynab-template/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node.js 22" src="https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white">
  <img alt="Docker ready" src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white">
  <img alt="Installable PWA" src="https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-5b321c"></a>
</p>

<p align="center">
  <a href="#product-tour">Product tour</a> ·
  <a href="#core-capabilities">Capabilities</a> ·
  <a href="#try-it-locally">Quick start</a> ·
  <a href="#white-label-it">White-labeling</a> ·
  <a href="#safety-model">Safety</a>
</p>

Tally is a self-hosted, white-label YNAB companion built around two access
roles: a **household admin** and a **household member**. It does not assume a
two-person household. The admin gets household-wide controls, while the member
gets a deliberately scoped view of the accounts and categories relevant to
them.

> [!NOTE]
> This template ships with mock services, seeded demo data, and placeholder
> configuration. The screenshots below contain no real financial data, phone
> numbers, or credentials.

## Product tour

### See the categories that matter—without the noise

Choose which categories appear on the overview, scan assigned and remaining
amounts, and spot pace problems before they become month-end surprises. Every
category opens into its scoped transaction history.

<p align="center">
  <a href="docs/images/overview.png">
    <img src="docs/images/overview.png" width="100%" alt="Tally overview showing ready to assign, category balances, and budget pace">
  </a>
  <br>
  <sub><strong>Focused overview:</strong> ready-to-assign status, personalized categories, and pace at a glance.</sub>
</p>

### Turn uncategorized transactions into a quick review queue

The Mystery Queue presents one decision at a time. AI suggestions provide a
ranked starting point and a plain-language reason; the user makes the final
categorization choice or picks a different category.

<p align="center">
  <a href="docs/images/mystery-queue.png">
    <img src="docs/images/mystery-queue.png" width="100%" alt="Mystery Queue showing an uncategorized transaction with AI category suggestions">
  </a>
  <br>
  <sub><strong>AI-assisted, human-decided:</strong> suggestions accelerate cleanup without silently changing the budget.</sub>
</p>

### Ask a question, then explore the answer

Ask about spending, merchants, categories, pace, or time periods in everyday
language. Tally returns a scoped numerical answer with the right visual—then
lets you click chart segments or follow-up actions to inspect the transactions
behind it without losing the original date range.

<p align="center">
  <a href="docs/images/ask-with-chart.png">
    <img src="docs/images/ask-with-chart.png" width="100%" alt="Tally answering a food spending question with a clickable donut chart">
  </a>
  <br>
  <sub><strong>Ask the budget:</strong> useful answers, interactive charts, and one-click follow-up questions.</sub>
</p>

## Core capabilities

| Daily budget experience | Automation with guardrails |
| --- | --- |
| **Personalized overview**<br>Show or hide categories per user and focus on the balances that matter. | **Verified synchronization**<br>Incremental YNAB sync reconciles before downstream jobs run, with 24 months of history by default. |
| **Budget pace**<br>See which categories are on track, need attention, or are running off pace. | **Funding pass and proposals**<br>Run an essentials-first monthly pass and review proposed funding for everything else. |
| **Mystery Queue**<br>Resolve uncategorized transactions from ranked AI suggestions or the full category list. | **Approval assistant**<br>Review or automatically approve familiar transactions using configurable history, consistency, amount, and per-sync safeguards. |
| **Ask the budget**<br>Get read-only answers, trends, merchant and category breakdowns, transaction lists, and clickable charts. | **Dry-run write gateway**<br>Log proposed mutations, reversal hints, and execution results before enabling live YNAB changes. |
| **Scoped member access**<br>Limit the member to configured accounts, category groups, and categories. | **Reconciliation fail-safe**<br>Pause downstream automation if local and YNAB transaction counts disagree. |

### More included out of the box

- Category drill-down pages with date-aware, scoped transaction history.
- Active and unhidden YNAB category syncing for the essentials selector.
- User-approved payee-to-category learning after repeated corrections.
- Subscription-creep, placeholder-target, and new-recurring-expense detectors
  that produce proposals instead of surprise changes.
- Spend-threshold alerts, Mystery Queue digests, and proposal approval by SMS.
- One-time SMS sign-in links with a six-digit PIN fallback, expiration, rate
  limits, and lockout protection.
- Responsive and installable PWA layouts for desktop and mobile.
- Docker deployment, optional Cloudflare Tunnel, and optional Litestream
  backups.
- Mock external services, seeded demo data, automated tests, and CI checks for
  safe evaluation before connecting a real budget.

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

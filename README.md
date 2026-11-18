# Security Awareness & Phishing Simulation Platform

A platform that helps organisations measure and reduce human cyber risk. Admins run
**authorised phishing simulations** against their own staff, and employees who fall for
one (or report it) get short, targeted **awareness training** straight away.

> **Authorised use only.** Simulations may only be sent to people in an organisation that has
> verified ownership of its sending domain and accepted the acceptable-use terms. See
> [docs/SAFETY.md](docs/SAFETY.md).

## Project progress

<!-- progress:start -->
**Overall: 29%** (6/21 tasks)

```
[██████░░░░░░░░░░░░░░░] 29%
```

| Stage | Progress | Status |
|-------|----------|--------|
| Phase 0: Foundation | `████████████████████` 100% (2/2) | ✅ Complete |
| **▶ Phase 1: Admin MVP** | `████████████░░░░░░░░` 60% (3/5) | 🚧 **In progress (current stage)** |
| Phase 2: Campaigns | `████░░░░░░░░░░░░░░░░` 20% (1/5) | 🚧 Partial |
| Phase 3: Training | `░░░░░░░░░░░░░░░░░░░░` 0% (0/3) | ⏳ Not started |
| Phase 4: Insights | `░░░░░░░░░░░░░░░░░░░░` 0% (0/3) | ⏳ Not started |
| Phase 5: Integrations | `░░░░░░░░░░░░░░░░░░░░` 0% (0/3) | ⏳ Not started |
<!-- progress:end -->

_Generated from [docs/ROADMAP.md](docs/ROADMAP.md). Tick a box there, then run `python3 scripts/progress.py`._

## Core features (planned)

| Area | What it does |
|------|--------------|
| Campaigns | Schedule simulations to groups, pick templates, set difficulty, track outcomes |
| Templates | Generic, clearly fictional scenarios (parcel delivery, password expiry, shared doc, invoice) |
| Landing pages | "You've been phished" teachable-moment page. It never collects real credentials |
| Reporting | Click rate, report rate, time-to-report, repeat-offender trend, per-department risk |
| Training | Micro-lessons and quizzes, auto-assigned after a simulation event |
| Report button | Endpoint/add-in hook so staff can report suspicious mail (rewarded, not punished) |
| Admin | Orgs, roles, groups, CSV import of employees, audit log |

## Stack

- **Next.js** (App Router, TypeScript) for admin dashboard and learner portal
- **Supabase** for Postgres, Auth and Row-Level Security (multi-tenant isolation per organisation)
- **Supabase Edge Functions** for the tracking endpoints and scheduled campaign sending
- **Transactional email provider** (e.g. Resend/Postmark) behind a small adapter

## Repository layout

```
docs/                 Architecture, roadmap, safety/ethics policy
supabase/migrations/  SQL migrations (schema + RLS)
.env.example          Required environment variables
```

App code (`app/`, `components/`, `lib/`) is added in Phase 1, see [docs/ROADMAP.md](docs/ROADMAP.md).

## Getting started

```bash
git clone https://github.com/Fast-Execute/Security-awareness-and-phishing-simulation-platform
cd Security-awareness-and-phishing-simulation-platform
cp .env.example .env.local
# create a Supabase project, then apply supabase/migrations/0001_init.sql
```

## Tests

```bash
npm test          # CSV parser and email renderer (Node 22.18+, no extra packages)
npm run test:db   # SQL guards + RLS against a throwaway local Postgres (needs PostgreSQL server binaries)
```

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Safety & acceptable use](docs/SAFETY.md)
- [Campaign sender operations](docs/CAMPAIGN_SENDER_OPERATIONS.md)

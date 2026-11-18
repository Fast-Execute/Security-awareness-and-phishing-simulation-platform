# Roadmap

## Phase 0: Foundation
- [x] README, architecture, safety policy
- [x] Initial schema and RLS

## Phase 1: Admin MVP
- [ ] Domain verification (DNS TXT) before any sending is enabled (DB guards tested; edge function written, untested)
- [x] Target import (CSV parser + `import_targets()` SQL, verified-domain only)
- [x] Target import and groups UI (CSV import, group creation and editable group membership)
- [x] Template library (5 to 8 generic scenarios)

## Phase 2: Campaigns
- [x] Campaign launch, scheduling, sending queue and tracking in SQL (`launch_campaign`, `claim_recipients`, `record_event`, `campaign_stats`)
- [x] Campaign builder UI
- [ ] `send-campaign` edge function: hardened with compare-and-set campaign claims, bounded batches, pacing, Resend idempotency keys, tenant/domain/AUP gates and credential-form rejection; still requires Deno/provider integration tests and deployment
- [ ] `track` edge function and teachable-moment page: open pixel, click event, and explicit self-report event are implemented; shared request rules/helpers have Node unit tests and GitHub Actions CI; still requires Deno type-check/integration tests and deployment
- [ ] Sender reliability: add pagination for large audiences and a database-backed claim lease/recovery routine before unattended scheduling
- [x] Organisation-scoped campaign results dashboard (aggregate opens, clicks and self-reported learning responses; per-campaign rows)

## Phase 3: Training
- [ ] Training modules and quizzes
- [ ] Auto-assignment after click, with reminder emails
- [ ] Learner portal

## Phase 4: Insights
- [ ] Department and trend dashboards
- [ ] Repeat-clicker coaching flow
- [ ] Export (CSV/PDF) for compliance reporting

## Phase 5: Integrations
- [ ] Outlook/Gmail report-phish button (real reporting integration; distinct from the in-page self-assessment)
- [ ] SSO (SAML/OIDC)
- [ ] Webhook and API for SIEM

# Roadmap

## Phase 0: Foundation
- [x] README, architecture, safety policy
- [x] Initial schema and RLS

## Phase 1: Admin MVP
- [x] Next.js app scaffold, Supabase Auth, org onboarding
- [ ] Domain verification (DNS TXT) before any sending is enabled (DB guards tested; edge function written, untested)
- [x] Target import (CSV parser + `import_targets()` SQL, verified-domain only)
- [x] Target import and groups UI (CSV import, group creation and editable group membership)
- [x] Template library (5 to 8 generic scenarios)

## Phase 2: Campaigns
- [x] Campaign launch, scheduling, sending queue and tracking in SQL (`launch_campaign`, `claim_recipients`, `record_event`, `campaign_stats`)
- [x] Campaign builder UI
- [ ] `send-campaign` edge function: hardened with compare-and-set campaign claims, bounded batches, pacing, Resend idempotency keys, tenant/domain/AUP gates and credential-form rejection; still requires Deno/provider integration tests and deployment
- [ ] `track` edge function and teachable-moment page: written, untested; open pixel and report button still to do
- [x] Organisation-scoped campaign results dashboard (aggregate metrics; per-campaign rows)

## Phase 3: Training
- [ ] Training modules and quizzes
- [ ] Auto-assignment after click, with reminder emails
- [ ] Learner portal

## Phase 4: Insights
- [ ] Department and trend dashboards
- [ ] Repeat-clicker coaching flow
- [ ] Export (CSV/PDF) for compliance reporting

## Phase 5: Integrations
- [ ] Outlook/Gmail report-phish button
- [ ] SSO (SAML/OIDC)
- [ ] Webhook and API for SIEM

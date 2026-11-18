# Roadmap

## Phase 0: Foundation
- [x] README, architecture, safety policy
- [x] Initial schema and RLS

## Phase 1: Admin MVP
- [x] Next.js app scaffold, Supabase Auth, org onboarding
- [ ] Domain verification (DNS TXT) before any sending is enabled (DB guards tested; edge function written, untested)
- [x] Target import (CSV parser + `import_targets()` SQL, verified-domain only)
- [ ] Target import and groups UI
- [x] Template library (5 to 8 generic scenarios)

## Phase 2: Campaigns
- [x] Campaign launch, scheduling, sending queue and tracking in SQL (`launch_campaign`, `claim_recipients`, `record_event`, `campaign_stats`)
- [ ] Campaign builder UI
- [ ] `send-campaign` edge function (idempotent, rate limited): written, untested (no Deno here); email adapter not yet checked against the provider's docs
- [ ] `track` edge function and teachable-moment page: written, untested; open pixel and report button still to do
- [ ] Per-campaign results view

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

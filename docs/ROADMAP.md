# Roadmap

## Phase 0: Foundation
- [x] README, architecture, safety policy
- [x] Initial schema and RLS

## Phase 1: Admin MVP
- [ ] Next.js app scaffold, Supabase Auth, org onboarding
- [ ] Domain verification (DNS TXT) before any sending is enabled
- [ ] Target import (CSV) and groups
- [ ] Template library (5 to 8 generic scenarios)

## Phase 2: Campaigns
- [ ] Campaign builder and scheduler
- [ ] `send-campaign` edge function (idempotent, rate limited)
- [ ] `track` edge function (open, click, report) and teachable-moment page
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

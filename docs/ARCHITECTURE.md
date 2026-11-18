# Architecture

## Overview

```
Admin (Next.js) ──► Supabase Postgres (RLS per org)
                          ▲
Scheduler (pg_cron) ──► Edge Function: send-campaign ──► Email provider
                                                           │
Employee inbox ◄───────────────────────────────────────────┘
   │ click / open / report
   ▼
Edge Function: track  ──► campaign_events ──► auto-assign training
   │
   ▼
Teachable-moment page (static, no credential capture)
```

## Key decisions

1. **Multi-tenant by `org_id` + RLS.** Every tenant table carries `org_id`; policies check
   membership through `org_members`. No cross-org reads, even for admins of another org.
2. **Tracking tokens, not raw IDs.** Each recipient gets a random, unguessable
   `tracking_token` per campaign. Tracking URLs expose the token only.
3. **Never collect credentials.** Landing pages record that a click or form interaction
   happened, never the values typed. There is no field in the schema to store them.
4. **Events are append-only.** `campaign_events` is insert-only. Metrics are derived by views.
5. **Report is a first-class outcome.** Reporting a simulation counts as a success and is
   tracked alongside clicks.
6. **Sending is idempotent.** `campaign_recipients.status` plus a unique constraint prevents
   duplicate sends on retry.
7. **Boring tech.** Postgres, plain SQL migrations, one email adapter. No queue until volume needs it.

## Data model (summary)

- `organizations`, `org_members` (roles: owner, admin, analyst)
- `domains` (verified sending domains per org)
- `groups`, `targets`, `group_targets` (the employees being trained)
- `templates` (simulation emails, difficulty, indicators to teach)
- `campaigns`, `campaign_recipients`, `campaign_events`
- `training_modules`, `training_assignments`
- `audit_log`

See `supabase/migrations/0001_init.sql`.

## Metrics

- **Click rate** = recipients with a `clicked` event ÷ delivered
- **Report rate** = recipients with a `reported` event ÷ delivered
- **Time to report** = first `reported` minus `delivered`
- **Repeat clicker** = a target who clicked in 2+ campaigns within 90 days

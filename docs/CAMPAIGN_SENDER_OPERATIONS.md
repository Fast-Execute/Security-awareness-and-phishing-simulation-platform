# Campaign sender operations

The `send-campaign` Edge Function is an authorised simulation sender. It is deliberately restricted to organisation-owned groups and templates, verified sending domains, and organisations that accepted the acceptable-use terms.

## Required Edge Function secrets

Configure these under Supabase Dashboard → Edge Functions → Secrets. Do not commit real values.

- `CAMPAIGN_CRON_SECRET`: a long random secret sent in the `x-campaign-secret` header by the trusted scheduler.
- `RESEND_API_KEY`: a Resend API key with the minimum sending permissions required.
- `SIMULATION_FROM_EMAIL`: a sender address whose domain exactly matches the verified domain attached to the campaign.
- Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Keep the service role key server-side only.
- Optional `CAMPAIGN_MAX_PER_RUN`: integer clamped to 1–50 (default 20).
- Optional `CAMPAIGN_SEND_INTERVAL_MS`: delay clamped to 500–5000 ms (default 1000).

## Scheduler invocation

Invoke the function using POST from a trusted scheduler. Never call it from a public browser.

```http
POST https://<project-ref>.supabase.co/functions/v1/send-campaign
x-campaign-secret: <CAMPAIGN_CRON_SECRET>
```

The function rejects other HTTP methods and requests without the shared secret. Configure the scheduler only after the organisation has approved the simulation and the sender domain is verified.

## Safety and retry behaviour

- Campaigns are claimed with a conditional `scheduled → sending` update so concurrent invocations cannot both own the same campaign.
- Recipients are processed in bounded batches, and each send is paced.
- Resend receives a stable idempotency key based on the campaign-recipient row. Resend documents a 24-hour idempotency window; keep retries within that window where possible.
- Only the supported `first_name` and `tracking_url` placeholders are accepted.
- HTML templates containing forms, inputs, or password fields are blocked. The platform does not collect or store passwords or submitted credentials.
- A provider-accepted message is recorded as `sent`, not `delivered`. A future verified provider webhook should record actual delivery events.
- Permanent provider 4xx errors mark a recipient failed; transient network errors, rate limits and provider 5xx responses remain pending for a later run.

## Pre-production checklist

1. Run the Node unit tests and add a Deno Edge Function type-check/integration test in a non-production Supabase project.
2. Test Resend with a verified domain and test inboxes owned by the organisation.
3. Confirm campaign, group, target and template rows are present and belong to the same organisation.
4. Confirm the organisation's acceptable-use agreement is accepted.
5. Verify that no request or template can submit credentials.
6. Confirm a second concurrent invocation skips a campaign already claimed by the first.
7. Confirm batches progress past the first page and retries reuse the same provider idempotency key.
8. Deploy only after these checks pass.

## Known operational limitation

A worker process terminated unexpectedly after claiming a campaign can leave its status at `sending`. The current schema does not include a claim timestamp or lease. Add a database-backed claim lease/recovery routine before relying on unattended production scheduling.

# Campaign sender and tracking operations

The campaign sender is an authorised awareness-simulation workflow. It is restricted to organisation-owned groups and templates, verified sending domains, and organisations that accepted the acceptable-use terms.

## Required Edge Function secrets

Configure these under Supabase Dashboard → Edge Functions → Secrets. Do not commit real values.

- `CAMPAIGN_CRON_SECRET`: a long random secret sent in the `x-campaign-secret` header by the trusted scheduler.
- `RESEND_API_KEY`: a Resend API key with the minimum sending permissions required.
- `SIMULATION_FROM_EMAIL`: a sender address whose domain exactly matches the verified domain attached to the campaign.
- Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Keep the service role key server-side only.
- Optional `CAMPAIGN_MAX_PER_RUN`: integer clamped to 1–50 (default 20).
- Optional `CAMPAIGN_SEND_INTERVAL_MS`: delay clamped to 500–5000 ms (default 1000).

## Scheduler invocation

Invoke the sender using POST from a trusted scheduler. Never call it from a public browser.

```http
POST https://<project-ref>.supabase.co/functions/v1/send-campaign
x-campaign-secret: <CAMPAIGN_CRON_SECRET>
```

The function rejects other HTTP methods and requests without the shared secret. Configure the scheduler only after the organisation has approved the simulation and the sender domain is verified.

## Tracking events

The `track` Edge Function accepts only a recipient's 48-character lowercase hexadecimal tracking token and the supported event/method combinations:

- `GET ?t=<token>&event=open`: records an `opened` event and returns a 1×1 transparent GIF. The sender adds this pixel to the delivered HTML message.
- `GET ?t=<token>` or `GET ?t=<token>&event=click`: records a `clicked` event and displays the teachable-moment page with scenario-specific red flags.
- `POST ?t=<token>&event=report`: records a `reported` self-assessment when the learner chooses “I would report a message like this” on that page.

The report button is intentionally described as a self-assessment. It does **not** forward the original message, contact the organisation's IT team, or represent an Outlook/Gmail report-phishing integration. Those integrations remain future work.

Open tracking is approximate. Image blocking, privacy proxies, caching and automated security scanners can suppress or trigger a pixel independently of a person reading the message. Treat opens as a directional aggregate signal, not proof of reading. Repeated events may be stored, while the results dashboard counts unique recipients per event type.

The endpoint does not store IP addresses or request bodies. It stores only the event type, recipient/organisation relationship, timestamp and a user-agent value truncated to 500 characters. No credentials, password fields or submitted message contents are collected.

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
5. Confirm no request or template can submit credentials.
6. Confirm a second concurrent invocation skips a campaign already claimed by the first.
7. Confirm batches progress past the first page and retries reuse the same provider idempotency key.
8. Verify open, click and self-report events using test recipients; verify the report response clearly says it is not sent to IT.
9. Deploy only after these checks pass.

## Known operational limitations

A worker process terminated unexpectedly after claiming a campaign can leave its status at `sending`. The current schema does not include a claim timestamp or lease. Add a database-backed claim lease/recovery routine before relying on unattended production scheduling.

The tracking and sending Edge Functions have not yet been type-checked or integration-tested against a connected Supabase project in this repository workflow. Do not treat the functions as production-deployed.

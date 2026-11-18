# Safety & Acceptable Use

This platform exists to train people, not to defraud them. These rules are enforced in
product design, not just policy.

## Rules

1. **Authorisation required.** Only organisations that accept the acceptable-use terms and
   verify control of their sending domain (DNS TXT record) can send simulations. Recipients
   must be that organisation's own staff or contractors.
2. **No real-brand impersonation.** The template library uses fictional brands. Custom
   templates cannot be published if they use a real third-party brand's name or logo.
3. **No credential capture.** Landing pages never store submitted form values. The schema has
   no column for them.
4. **Teachable moment immediately.** Any click or form interaction leads to an explanation page
   showing the red flags in the email that was missed.
5. **Fair treatment.** Results are for coaching and risk measurement. Reporting a simulation is
   tracked as a positive outcome.
6. **Data minimisation.** Store only work email, name, department, and simulation outcomes.
   Provide per-org deletion/export to support POPIA/GDPR requests.
7. **Rate limits and allow-listing.** Sending is rate limited per org, and simulation mail
   carries a header so the org's security team can allow-list it.
8. **Audit trail.** Campaign creation, launches and exports are written to `audit_log`.

// Edge Function: send-campaign
// POST { "campaign_id": "<uuid>" }
// Callers: an org owner/admin (user JWT) or an internal scheduler holding the service-role key.
// Claims recipients in small batches, sends, and records the outcome. Safe to call repeatedly:
// claims use leases, and a recipient is only ever marked sent once.

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail } from "../_shared/email.ts";
import {
  buildFrom, firstName, htmlToText, renderTemplate, safeEqual, trackingUrl,
} from "../_shared/render.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 25;
const TIME_BUDGET_MS = 45_000;
const PAUSE_MS = 250; // simple rate limit: about 4 emails per second

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const emailKey = Deno.env.get("EMAIL_PROVIDER_API_KEY");
  const appBase = Deno.env.get("APP_BASE_URL");
  if (!emailKey || !appBase) return json({ error: "server is not configured for sending" }, 500);

  const body = await req.json().catch(() => null);
  const campaignId = body?.campaign_id;
  if (typeof campaignId !== "string" || !UUID_RE.test(campaignId)) {
    return json({ error: "campaign_id must be a uuid" }, 400);
  }

  const admin = createClient(url, serviceKey);

  // Authorise: internal scheduler (service key) or an admin of the campaign's organisation.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!safeEqual(bearer, serviceKey)) {
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: camp } = await userClient.from("campaigns").select("org_id").eq("id", campaignId).maybeSingle();
    if (!camp) return json({ error: "campaign not found" }, 404);
    const { data: ok } = await userClient.rpc("is_org_member", { p_org: camp.org_id, p_roles: ["owner", "admin"] });
    if (!ok) return json({ error: "forbidden" }, 403);
  }

  const started = Date.now();
  let sent = 0, failed = 0, deferred = 0;

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: batch, error } = await admin.rpc("claim_recipients", { p_campaign: campaignId, p_limit: BATCH });
    if (error) return json({ error: "could not claim recipients" }, 500);
    if (!batch || batch.length === 0) break;

    for (const r of batch) {
      try {
        const vars = { first_name: firstName(r.full_name), tracking_url: trackingUrl(appBase, r.tracking_token) };
        const html = renderTemplate(r.body_html, vars, "html");
        const result = await sendEmail(emailKey, {
          from: buildFrom(r.sender_name, r.sender_local, r.domain),
          to: r.email,
          subject: renderTemplate(r.subject, vars, "text"),
          html,
          text: htmlToText(html),
          // Lets the organisation's security team allow-list or identify simulation mail.
          headers: { "X-Phishing-Simulation": campaignId },
          idempotencyKey: r.recipient_id,
        });
        if (result.ok) {
          await admin.rpc("mark_recipient_sent", { p_recipient: r.recipient_id });
          sent++;
        } else if (result.transient) {
          deferred++; // stays claimed; the lease expires and a later run retries it
        } else {
          await admin.rpc("mark_recipient_failed", { p_recipient: r.recipient_id, p_reason: result.reason });
          failed++;
        }
      } catch (e) {
        // A bad template or address is permanent for this recipient; do not retry forever.
        await admin.rpc("mark_recipient_failed", { p_recipient: r.recipient_id, p_reason: (e as Error).message });
        failed++;
      }
      await sleep(PAUSE_MS);
    }
  }

  const { count: remaining } = await admin
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "pending");
  const { data: c } = await admin.from("campaigns").select("status").eq("id", campaignId).maybeSingle();

  return json({ sent, failed, deferred, remaining: remaining ?? 0, status: c?.status ?? null });
});

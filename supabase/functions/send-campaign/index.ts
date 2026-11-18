import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CAMPAIGN_CRON_SECRET")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("SIMULATION_FROM_EMAIL")!;
const MAX_PER_RUN = Number(Deno.env.get("CAMPAIGN_MAX_PER_RUN") || "20");
const db = createClient(SUPABASE_URL, SERVICE_ROLE);

function firstName(fullName: string | null) { return fullName?.trim().split(/\s+/)[0] || "there"; }
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]!)); }

async function sendEmail(to: string, subject: string, html: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html })
  });
  if (!response.ok) throw new Error(`provider returned ${response.status}`);
}

Deno.serve(async req => {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });
  if (!CRON_SECRET || req.headers.get("x-campaign-secret") !== CRON_SECRET) return new Response("unauthorized", { status: 401 });
  if (!RESEND_API_KEY || !FROM_EMAIL) return new Response("sending provider is not configured", { status: 503 });

  const fromDomain = FROM_EMAIL.split("@")[1]?.toLowerCase();
  if (!fromDomain) return new Response("invalid simulation sender", { status: 500 });

  const { data: campaigns, error } = await db.from("campaigns")
    .select("id,org_id,name,template_id,domain_id,group_id,status,scheduled_at")
    .eq("status", "scheduled").lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at").limit(10);
  if (error) return new Response(error.message, { status: 500 });

  const results: Record<string, unknown>[] = [];

  for (const campaign of campaigns || []) {
    const [{ data: org }, { data: domain }, { data: template }, { data: group }] = await Promise.all([
      db.from("organizations").select("aup_accepted_at").eq("id", campaign.org_id).maybeSingle(),
      db.from("domains").select("domain,verified_at").eq("id", campaign.domain_id).eq("org_id", campaign.org_id).maybeSingle(),
      db.from("templates").select("name,subject,body_html").eq("id", campaign.template_id)
        .or(`org_id.is.null,org_id.eq.${campaign.org_id}`).maybeSingle(),
      db.from("groups").select("id").eq("id", campaign.group_id).eq("org_id", campaign.org_id).maybeSingle()
    ]);

    if (!org?.aup_accepted_at || !domain?.verified_at || domain.domain !== fromDomain || !template || !group) {
      results.push({ campaign_id: campaign.id, status: "blocked", reason: "safety gate failed" });
      continue;
    }

    const { error: lockError } = await db.from("campaigns").update({ status: "sending" })
      .eq("id", campaign.id).eq("status", "scheduled");
    if (lockError) { results.push({ campaign_id: campaign.id, status: "error", reason: lockError.message }); continue; }

    const { data: members, error: memberError } = await db.from("group_targets")
      .select("target_id,targets(id,email,full_name)").eq("group_id", campaign.group_id).limit(MAX_PER_RUN);
    if (memberError) { results.push({ campaign_id: campaign.id, status: "error", reason: memberError.message }); continue; }

    let sent = 0, failed = 0;
    for (const member of members || []) {
      const target = (member as any).targets;
      if (!target?.email) continue;

      const { data: existing } = await db.from("campaign_recipients")
        .select("id,status,tracking_token").eq("campaign_id", campaign.id).eq("target_id", target.id).maybeSingle();
      if (existing?.status === "sent") continue;

      const { data: recipient, error: recipientError } = await db.from("campaign_recipients")
        .upsert({ campaign_id: campaign.id, org_id: campaign.org_id, target_id: target.id },
          { onConflict: "campaign_id,target_id" }).select("id,tracking_token").single();
      if (recipientError || !recipient) { failed++; continue; }

      const trackingUrl = `${SUPABASE_URL}/functions/v1/track?t=${encodeURIComponent(recipient.tracking_token)}`;
      const html = template.body_html
        .replaceAll("{{first_name}}", escapeHtml(firstName(target.full_name)))
        .replaceAll("{{tracking_url}}", trackingUrl);

      try {
        await sendEmail(target.email, template.subject.replaceAll("{{first_name}}", firstName(target.full_name)), html);
        await db.from("campaign_recipients").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", recipient.id);
        await db.from("campaign_events").insert({ recipient_id: recipient.id, org_id: campaign.org_id, type: "delivered" });
        sent++;
      } catch {
        await db.from("campaign_recipients").update({ status: "failed" }).eq("id", recipient.id);
        failed++;
      }
    }

    const { count: pending } = await db.from("campaign_recipients")
      .select("id", { count: "exact", head: true }).eq("campaign_id", campaign.id).eq("status", "pending");
    await db.from("campaigns").update({ status: pending ? "scheduled" : "completed" }).eq("id", campaign.id);
    results.push({ campaign_id: campaign.id, status: "processed", sent, failed, pending: pending || 0 });
  }

  return Response.json({ processed: results.length, results });
});

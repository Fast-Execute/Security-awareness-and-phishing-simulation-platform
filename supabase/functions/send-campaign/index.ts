import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { firstName, isSafeSimulationTemplate, renderTemplate } from "../_shared/render.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CAMPAIGN_CRON_SECRET") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("SIMULATION_FROM_EMAIL") ?? "";
const configuredBatch = Number(Deno.env.get("CAMPAIGN_MAX_PER_RUN") ?? "20");
const MAX_PER_RUN = Number.isFinite(configuredBatch) ? Math.min(50, Math.max(1, Math.floor(configuredBatch))) : 20;
const configuredDelay = Number(Deno.env.get("CAMPAIGN_SEND_INTERVAL_MS") ?? "1000");
const SEND_INTERVAL_MS = Number.isFinite(configuredDelay) ? Math.min(5000, Math.max(500, configuredDelay)) : 1000;

const db = SUPABASE_URL && SERVICE_ROLE ? createClient(SUPABASE_URL, SERVICE_ROLE) : null;

type Campaign = {
  id: string; org_id: string; name: string; template_id: string;
  domain_id: string; group_id: string | null; status: string; scheduled_at: string | null;
};
type Target = { id: string; org_id: string; email: string; full_name: string | null };
type Recipient = { id: string; target_id: string; status: "pending" | "sent" | "failed"; tracking_token: string };

function senderDomain(value: string): string | null {
  const address = value.match(/<([^<>]+)>/)?.[1] ?? value.trim();
  const match = address.match(/^[^@\\s<>]+@([^@\\s<>]+)$/);
  return match?.[1]?.toLowerCase() ?? null;
}

class ProviderError extends Error { constructor(public status: number) { super(`email provider returned ${status}`); } }

async function sendEmail(to: string, subject: string, html: string, idempotencyKey: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!response.ok) {
    throw new ProviderError(response.status);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async req => {
  if (req.method !== "POST") return new Response("POST required", { status: 405, headers: { Allow: "POST" } });
  if (!CRON_SECRET || req.headers.get("x-campaign-secret") !== CRON_SECRET) return new Response("unauthorized", { status: 401 });
  if (!db || !RESEND_API_KEY || !FROM_EMAIL) return new Response("sending provider is not configured", { status: 503 });

  const fromDomain = senderDomain(FROM_EMAIL);
  if (!fromDomain) return new Response("invalid simulation sender", { status: 500 });

  const { data: campaigns, error } = await db.from("campaigns")
    .select("id,org_id,name,template_id,domain_id,group_id,status,scheduled_at")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at")
    .limit(10);
  if (error) return new Response("campaign queue unavailable", { status: 500 });

  const results: Record<string, unknown>[] = [];

  for (const campaign of (campaigns ?? []) as Campaign[]) {
    // Validate all tenant and sender controls before claiming a campaign.
    const [{ data: org }, { data: domain }, { data: template }, { data: group }] = await Promise.all([
      db.from("organizations").select("aup_accepted_at").eq("id", campaign.org_id).maybeSingle(),
      db.from("domains").select("domain,verified_at").eq("id", campaign.domain_id).eq("org_id", campaign.org_id).maybeSingle(),
      db.from("templates").select("name,subject,body_html").eq("id", campaign.template_id)
        .or(`org_id.is.null,org_id.eq.${campaign.org_id}`).maybeSingle(),
      campaign.group_id
        ? db.from("groups").select("id").eq("id", campaign.group_id).eq("org_id", campaign.org_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (!org?.aup_accepted_at || !domain?.verified_at || domain.domain !== fromDomain || !template || !group ||
        !isSafeSimulationTemplate(template.subject, template.body_html)) {
      results.push({ campaign_id: campaign.id, status: "blocked", reason: "safety gate failed" });
      continue;
    }

    // Compare-and-set claim: only the invocation that changes scheduled -> sending owns this campaign.
    const { data: claimed, error: claimError } = await db.from("campaigns")
      .update({ status: "sending" })
      .eq("id", campaign.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();

    if (claimError) {
      results.push({ campaign_id: campaign.id, status: "error", reason: "campaign claim failed" });
      continue;
    }
    if (!claimed) {
      results.push({ campaign_id: campaign.id, status: "skipped", reason: "already claimed by another worker" });
      continue;
    }

    let sent = 0;
    let failed = 0;
    let remaining = 0;

    try {
      const { data: groupLinks, error: linksError } = await db.from("group_targets")
        .select("target_id").eq("group_id", campaign.group_id);
      if (linksError) throw new Error("unable to load group membership");

      const targetIds = [...new Set((groupLinks ?? []).map(row => row.target_id))];
      if (targetIds.length === 0) {
        await db.from("campaigns").update({ status: "completed" }).eq("id", campaign.id).eq("status", "sending");
        results.push({ campaign_id: campaign.id, status: "completed", sent: 0, failed: 0, note: "empty audience" });
        continue;
      }

      const [{ data: targetRows, error: targetsError }, { data: recipientRows, error: recipientsError }] = await Promise.all([
        db.from("targets").select("id,org_id,email,full_name").eq("org_id", campaign.org_id).in("id", targetIds),
        db.from("campaign_recipients").select("id,target_id,status,tracking_token").eq("campaign_id", campaign.id),
      ]);
      if (targetsError || recipientsError) throw new Error("unable to load campaign recipients");

      const targetById = new Map((targetRows ?? []).map(row => [row.id, row as Target]));
      const recipientByTarget = new Map((recipientRows ?? []).map(row => [row.target_id, row as Recipient]));
      const eligible = targetIds
        .map(id => targetById.get(id))
        .filter((target): target is Target => Boolean(target && target.org_id === campaign.org_id &&
          target.email && !["sent", "failed"].includes(recipientByTarget.get(target.id)?.status ?? "")))
        .slice(0, MAX_PER_RUN);

      for (const target of eligible) {
        let recipient = recipientByTarget.get(target.id);
        if (!recipient) {
          const { data, error: insertError } = await db.from("campaign_recipients")
            .upsert({ campaign_id: campaign.id, org_id: campaign.org_id, target_id: target.id },
              { onConflict: "campaign_id,target_id" })
            .select("id,target_id,status,tracking_token")
            .single();
          if (insertError || !data) { failed++; continue; }
          recipient = data as Recipient;
        }
        if (recipient.status !== "pending") continue;

        const trackingUrl = `${SUPABASE_URL}/functions/v1/track?t=${encodeURIComponent(recipient.tracking_token)}`;
        let html: string;
        let subject: string;
        try {
          html = renderTemplate(template.body_html, { first_name: firstName(target.full_name), tracking_url: trackingUrl }, "html");
          subject = renderTemplate(template.subject, { first_name: firstName(target.full_name), tracking_url: trackingUrl }, "text");
        } catch {
          await db.from("campaign_recipients").update({ status: "failed" }).eq("id", recipient.id);
          failed++;
          continue;
        }

        try {
          // Stable provider key prevents duplicate sends if the worker retries after a network timeout.
          await sendEmail(target.email, subject, html, `campaign-recipient/${recipient.id}`);
          const { error: updateError } = await db.from("campaign_recipients")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", recipient.id)
            .eq("status", "pending");
          if (updateError) throw new Error("sent status could not be recorded");
          sent++;
        } catch (error) {
          // Retry network errors, rate limits and provider 5xx responses using the same provider key.
          // Permanent provider 4xx responses are terminal for this recipient.
          const retryable = !(error instanceof ProviderError) || error.status === 429 || error.status >= 500 || error.status === 409;
          const { data: latest } = await db.from("campaign_recipients")
            .select("status").eq("id", recipient.id).maybeSingle();
          if (latest?.status !== "sent" && !retryable) {
            await db.from("campaign_recipients").update({ status: "failed" }).eq("id", recipient.id).eq("status", "pending");
            failed++;
          }
        }

        await sleep(SEND_INTERVAL_MS);
      }

      const { count: unfinished, error: countError } = await db.from("campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .eq("status", "pending");
      if (countError) throw new Error("unable to determine remaining work");
      remaining = unfinished ?? 0;

      // Count targets not yet represented by a recipient row, so later batches are not skipped.
      const processedTargetIds = new Set((recipientRows ?? []).map(row => row.target_id));
      const unrepresented = targetIds.filter(id => targetById.has(id) && !processedTargetIds.has(id));
      remaining += unrepresented.length;

      const nextStatus = remaining > 0 ? "scheduled" : "completed";
      const { error: finishError } = await db.from("campaigns").update({ status: nextStatus })
        .eq("id", campaign.id).eq("status", "sending");
      if (finishError) throw new Error("campaign state could not be finalised");

      results.push({ campaign_id: campaign.id, status: "processed", sent, failed, remaining });
    } catch {
      // Release the claim for a later retry. Recipient rows already marked sent remain idempotently skipped.
      await db.from("campaigns").update({ status: "scheduled" }).eq("id", campaign.id).eq("status", "sending");
      results.push({ campaign_id: campaign.id, status: "retry_queued", sent, failed });
    }
  }

  return Response.json({ processed: results.length, results });
});

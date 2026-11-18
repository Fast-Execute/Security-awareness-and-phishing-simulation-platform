import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE);

function page(title: string, scenario: string, flags: string[]) {
  const list = flags.map(f => `<li>${f.replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]!) )}</li>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.6}article{border:1px solid #ddd;border-radius:12px;padding:28px}h1{margin-top:0}.ok{padding:14px;border:1px solid #ddd;border-radius:8px}li{margin:10px 0}</style></head>
  <body><article><p><strong>SECURITY AWARENESS SIMULATION</strong></p><h1>This was a phishing simulation.</h1>
  <p>You reached this page because the message was part of an authorised security-awareness exercise.</p>
  <div class="ok"><strong>Scenario:</strong> ${scenario}</div>
  <h2>What should have raised suspicion?</h2><ul>${list}</ul>
  <h2>What to do next time</h2><p>Pause. Check the sender address and destination before clicking. Be cautious with urgency, unexpected requests and rewards. If you are unsure, report the message using your organisation's normal reporting process.</p>
  <p><strong>No password was requested or stored by this simulation.</strong></p></article></body></html>`;
}

Deno.serve(async req => {
  if (req.method !== "GET") return new Response("GET required", {status:405});
  const token = new URL(req.url).searchParams.get("t");
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return new Response("Invalid simulation link.", {status:400});

  const {data: recipient} = await db.from("campaign_recipients")
    .select("id,org_id,campaign_id,target_id,status")
    .eq("tracking_token", token).maybeSingle();
  if (!recipient) return new Response("Simulation link not found or expired.", {status:404});

  const [{data: campaign},{data: template}] = await Promise.all([
    db.from("campaigns").select("name,template_id").eq("id",recipient.campaign_id).eq("org_id",recipient.org_id).maybeSingle(),
    db.from("templates").select("name,red_flags").eq("id", (await db.from("campaigns").select("template_id").eq("id",recipient.campaign_id).maybeSingle()).data?.template_id || "").maybeSingle()
  ]);
  if (!campaign || !template) return new Response("Simulation unavailable.", {status:404});

  await db.from("campaign_events").insert({
    recipient_id: recipient.id, org_id: recipient.org_id, type: "clicked",
    user_agent: req.headers.get("user-agent")?.slice(0,500) || null
  });

  return new Response(page("Simulation complete", template.name, template.red_flags || []), {
    headers: {"content-type":"text/html; charset=utf-8", "cache-control":"no-store"}
  });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = SUPABASE_URL && SERVICE_ROLE ? createClient(SUPABASE_URL, SERVICE_ROLE) : null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function page(scenario: string, flags: string[], reportUrl: string) {
  const list = flags.map(flag => `<li>${escapeHtml(flag)}</li>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Simulation complete</title>
  <style>body{font-family:system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.6}article{border:1px solid #ddd;border-radius:12px;padding:28px}h1{margin-top:0}.ok{padding:14px;border:1px solid #ddd;border-radius:8px}li{margin:10px 0}button{padding:12px 18px;border:0;border-radius:8px;background:#173f35;color:white;font:inherit;cursor:pointer}</style></head>
  <body><article><p><strong>SECURITY AWARENESS SIMULATION</strong></p><h1>This was a phishing simulation.</h1>
  <p>You reached this page because the message was part of an authorised security-awareness exercise.</p>
  <div class="ok"><strong>Scenario:</strong> ${escapeHtml(scenario)}</div>
  <h2>What should have raised suspicion?</h2><ul>${list}</ul>
  <h2>What to do next time</h2><p>Pause. Check the sender address and destination before clicking. Be cautious with urgency, unexpected requests and rewards. If you are unsure, report the message using your organisation's normal reporting process.</p>
  <p><strong>No password was requested or stored by this simulation.</strong></p>
  <hr><h2>Would you have reported this message?</h2><p>This optional learning check records your self-reported intention only. It does not send a message to your IT team or mailbox.</p>
  <form method="post" action="${escapeHtml(reportUrl)}"><button type="submit">I would report a message like this</button></form></article></body></html>`;
}

const transparentGif = new Uint8Array([
  71,73,70,56,57,97,1,0,1,0,128,0,0,255,255,255,0,0,0,33,249,4,1,0,0,0,0,
  44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59,
]);

Deno.serve(async req => {
  if (!db) return new Response("Tracking is not configured.", { status: 503 });
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response("GET or POST required", { status: 405, headers: { Allow: "GET, POST" } });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const event = url.searchParams.get("event") ?? "click";
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return new Response("Invalid simulation link.", { status: 400 });
  if (!["open", "click", "report"].includes(event)) return new Response("Unsupported tracking event.", { status: 400 });
  if ((event === "report" && req.method !== "POST") || (event !== "report" && req.method !== "GET")) {
    return new Response("Method not allowed for this event.", { status: 405 });
  }

  const { data: recipient, error: recipientError } = await db.from("campaign_recipients")
    .select("id,org_id,campaign_id").eq("tracking_token", token).maybeSingle();
  if (recipientError) return new Response("Tracking temporarily unavailable.", { status: 503 });
  if (!recipient) return new Response("Simulation link not found or expired.", { status: 404 });

  // Do not retain IP addresses or request bodies. Only a bounded user-agent is recorded.
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) || null;

  if (event === "open") {
    const { error } = await db.from("campaign_events").insert({
      recipient_id: recipient.id, org_id: recipient.org_id, type: "opened", user_agent: userAgent,
    });
    if (error) return new Response("Tracking temporarily unavailable.", { status: 503 });
    return new Response(transparentGif, {
      headers: {
        "content-type": "image/gif",
        "cache-control": "no-store, no-cache, must-revalidate, private",
        "content-length": String(transparentGif.byteLength),
        "x-content-type-options": "nosniff",
      },
    });
  }

  if (event === "report") {
    const { error } = await db.from("campaign_events").insert({
      recipient_id: recipient.id, org_id: recipient.org_id, type: "reported", user_agent: userAgent,
    });
    if (error) return new Response("Your learning response could not be recorded. Please try again.", { status: 503 });
    return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Response recorded</title></head><body style="font-family:system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;line-height:1.6"><h1>Thanks — your learning response was recorded.</h1><p>This was a self-assessment only. No report was sent to your organisation's IT team.</p><p>No credentials or message contents were collected.</p></body></html>`, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const { error: clickError } = await db.from("campaign_events").insert({
    recipient_id: recipient.id, org_id: recipient.org_id, type: "clicked", user_agent: userAgent,
  });
  if (clickError) return new Response("Tracking temporarily unavailable.", { status: 503 });

  const { data: campaign } = await db.from("campaigns").select("template_id")
    .eq("id", recipient.campaign_id).eq("org_id", recipient.org_id).maybeSingle();
  if (!campaign) return new Response("Simulation unavailable.", { status: 404 });
  const { data: template } = await db.from("templates").select("name,red_flags")
    .eq("id", campaign.template_id).maybeSingle();
  if (!template) return new Response("Simulation unavailable.", { status: 404 });

  const reportUrl = new URL(req.url);
  reportUrl.searchParams.set("event", "report");
  return new Response(page(template.name, template.red_flags || [], reportUrl.toString()), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
});

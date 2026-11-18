// Edge Function: verify-domain
// POST { "domain_id": "<uuid>" } with the user's JWT in the Authorization header.
// Checks for a TXT record at _phishsim-verify.<domain> whose value equals the domain's
// verification_token, then marks the domain verified.

import { createClient } from "npm:@supabase/supabase-js@2";

const RECORD_PREFIX = "_phishsim-verify";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_BASE_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Act as the caller so RLS decides what they can see.
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const domainId = body?.domain_id;
  if (typeof domainId !== "string" || !UUID_RE.test(domainId)) {
    return json({ error: "domain_id must be a uuid" }, 400);
  }

  // RLS hides domains from non-members, so "not found" covers both cases.
  const { data: dom } = await userClient
    .from("domains")
    .select("id, org_id, domain, verification_token, verified_at")
    .eq("id", domainId)
    .maybeSingle();
  if (!dom) return json({ error: "domain not found" }, 404);

  const { data: isAdmin } = await userClient.rpc("is_org_member", {
    p_org: dom.org_id,
    p_roles: ["owner", "admin"],
  });
  if (!isAdmin) return json({ error: "forbidden" }, 403);

  const recordName = `${RECORD_PREFIX}.${dom.domain}`;
  if (dom.verified_at) return json({ verified: true, already: true, record_name: recordName });

  let records: string[][] = [];
  try {
    records = await Deno.resolveDns(recordName, "TXT");
  } catch {
    // NXDOMAIN or no TXT record yet: treated as not verified.
  }
  // A long TXT value can be split into several strings; join them before comparing.
  const matched = records.some((parts) => parts.join("") === dom.verification_token);

  if (!matched) {
    return json({
      verified: false,
      record_name: recordName,
      record_type: "TXT",
      expected_value: dom.verification_token,
      hint: "DNS changes can take a while to propagate. Try again shortly.",
    });
  }

  // The service role bypasses the guard trigger, which is the only way verified_at can be set.
  const admin = createClient(url, serviceKey);
  const { error: updErr } = await admin
    .from("domains")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", dom.id)
    .is("verified_at", null);
  if (updErr) return json({ error: "could not save verification" }, 500);

  await admin.from("audit_log").insert({
    org_id: dom.org_id,
    actor: userData.user.id,
    action: "domain.verified",
    detail: { domain: dom.domain },
  });

  return json({ verified: true, record_name: recordName });
});

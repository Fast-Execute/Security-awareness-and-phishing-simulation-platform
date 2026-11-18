// Edge Function: track (public, no JWT; see supabase/config.toml)
// POST { "token": "<48 hex>", "event": "clicked" | "submitted" | "reported" }
// Called server-side by the app's /t/[token] page. Returns what the teachable-moment page needs.
// Unknown or malformed tokens get the same neutral answer, so tokens cannot be probed.

import { createClient } from "npm:@supabase/supabase-js@2";
import { isValidToken } from "../_shared/render.ts";

const EVENTS = new Set(["clicked", "submitted", "reported"]);
const NEUTRAL = { recorded: false, template_name: null, red_flags: [] as string[] };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const raw = await req.text();
  if (raw.length > 2048) return json({ error: "payload too large" }, 413);
  let body: { token?: unknown; event?: unknown; user_agent?: unknown } | null = null;
  try { body = JSON.parse(raw); } catch { /* handled below */ }

  if (!body || typeof body.event !== "string" || !EVENTS.has(body.event)) {
    return json({ error: "invalid event" }, 400);
  }
  if (!isValidToken(body.token)) return json(NEUTRAL);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ua = typeof body.user_agent === "string" ? body.user_agent.slice(0, 300) : null;
  const { data, error } = await admin.rpc("record_event", {
    p_token: body.token, p_type: body.event, p_user_agent: ua,
  });
  if (error) return json({ error: "could not record event" }, 500);
  return json(data ?? NEUTRAL);
});

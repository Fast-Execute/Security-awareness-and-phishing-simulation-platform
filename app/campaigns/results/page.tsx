import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "../../../lib/supabase/server";

type Campaign = {
  id: string;
  name: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
};

type Recipient = { id: string; campaign_id: string; status: string };
type Event = { recipient_id: string; type: string };

function rate(n: number, denominator: number) {
  return denominator ? `${((n / denominator) * 100).toFixed(1)}%` : "—";
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16 }}>
    <div style={{ color: "#666", fontSize: 13 }}>{label}</div>
    <div style={{ fontSize: 27, fontWeight: 700, marginTop: 4 }}>{value}</div>
    {hint && <div style={{ color: "#777", fontSize: 12, marginTop: 4 }}>{hint}</div>}
  </div>;
}

export default async function CampaignResultsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id, organizations(id,name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/onboarding");
  const org = (membership as any).organizations as { id: string; name: string } | null;
  if (!org) redirect("/onboarding");

  const { data: campaigns, error: campaignError } = await supabase
    .from("campaigns")
    .select("id,name,status,scheduled_at,created_at")
    .eq("org_id", org.id)
    .order("created_at", { ascending: false });

  if (campaignError) throw new Error("Unable to load campaign results.");

  const campaignRows = (campaigns || []) as Campaign[];
  const ids = campaignRows.map(c => c.id);
  let recipients: Recipient[] = [];
  let events: Event[] = [];

  if (ids.length) {
    const { data: recipientRows, error: recipientError } = await supabase
      .from("campaign_recipients")
      .select("id,campaign_id,status")
      .eq("org_id", org.id)
      .in("campaign_id", ids);
    if (recipientError) throw new Error("Unable to load campaign recipients.");
    recipients = (recipientRows || []) as Recipient[];

    const recipientIds = recipients.map(r => r.id);
    if (recipientIds.length) {
      const { data: eventRows, error: eventError } = await supabase
        .from("campaign_events")
        .select("recipient_id,type")
        .eq("org_id", org.id)
        .in("recipient_id", recipientIds);
      if (eventError) throw new Error("Unable to load campaign activity.");
      events = (eventRows || []) as Event[];
    }
  }

  const byCampaign = new Map<string, Recipient[]>();
  for (const recipient of recipients) {
    const list = byCampaign.get(recipient.campaign_id) || [];
    list.push(recipient);
    byCampaign.set(recipient.campaign_id, list);
  }

  const eventsByRecipient = new Map<string, Set<string>>();
  const totals = { audience: recipients.length, sent: 0, failed: 0, clicked: 0, reported: 0, opened: 0 };
  for (const recipient of recipients) {
    if (recipient.status === "sent") totals.sent++;
    if (recipient.status === "failed") totals.failed++;
  }
  for (const event of events) {
    const set = eventsByRecipient.get(event.recipient_id) || new Set<string>();
    set.add(event.type);
    eventsByRecipient.set(event.recipient_id, set);
  }
  for (const types of eventsByRecipient.values()) {
    if (types.has("clicked")) totals.clicked++;
    if (types.has("reported")) totals.reported++;
    if (types.has("opened")) totals.opened++;
  }

  const cards = [
    ["Recipients", totals.audience],
    ["Sent", totals.sent],
    ["Failed", totals.failed],
    ["Unique opens", totals.opened],
    ["Unique clickers", totals.clicked],
    ["Self-reported", totals.reported],
  ] as const;

  return <main style={{ maxWidth: 1100, margin: "3rem auto", padding: "0 1rem" }}>
    <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div><p style={{ color: "#666", marginBottom: 4 }}>{org.name}</p><h1 style={{ marginTop: 0 }}>Campaign results</h1></div>
      <nav style={{ display: "flex", gap: 14 }}><Link href="/dashboard">Dashboard</Link><Link href="/campaigns">Campaign builder</Link><Link href="/people">People & groups</Link></nav>
    </header>

    <p>Organisation-wide aggregate outcomes. Opens, clicks and self-reported responses count unique recipients, not repeated events. No passwords or submitted credentials are collected.</p>

    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 12, margin: "24px 0 32px" }}>
      {cards.map(([label, value]) => <Metric key={label} label={label} value={value} />)}
      <Metric label="Open rate" value={rate(totals.opened, totals.sent)} hint="Unique opens ÷ sent (approximate)" />
      <Metric label="Click rate" value={rate(totals.clicked, totals.sent)} hint="Unique clickers ÷ sent" />
      <Metric label="Self-report rate" value={rate(totals.reported, totals.sent)} hint="Unique self-reports ÷ sent" />
    </section>

    <h2>Campaign activity</h2>
    {!campaignRows.length ? <section style={{ border: "1px dashed #aaa", borderRadius: 10, padding: 24 }}>
      <p>No campaigns have been created yet.</p><Link href="/campaigns">Build your first awareness campaign →</Link>
    </section> : <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
        <thead><tr style={{ textAlign: "left", borderBottom: "2px solid #ccc" }}>
          {["Campaign","Status","Audience","Sent","Failed","Unique opens","Open rate","Unique clicks","Click rate","Self-reports","Self-report rate"].map(label => <th key={label} style={{ padding: 10 }}>{label}</th>)}
        </tr></thead>
        <tbody>{campaignRows.map(campaign => {
          const group = byCampaign.get(campaign.id) || [];
          const recipientIds = new Set(group.map(r => r.id));
          const seen = new Map<string, Set<string>>();
          for (const event of events) if (recipientIds.has(event.recipient_id)) {
            const set = seen.get(event.recipient_id) || new Set<string>();
            set.add(event.type); seen.set(event.recipient_id, set);
          }
          const sent = group.filter(r => r.status === "sent").length;
          const failed = group.filter(r => r.status === "failed").length;
          const opened = [...seen.values()].filter(s => s.has("opened")).length;
          const clicked = [...seen.values()].filter(s => s.has("clicked")).length;
          const reported = [...seen.values()].filter(s => s.has("reported")).length;
          return <tr key={campaign.id} style={{ borderBottom: "1px solid #ddd" }}>
            <td style={{ padding: 10 }}><strong>{campaign.name}</strong><div style={{ color: "#777", fontSize: 12 }}>{campaign.scheduled_at ? new Date(campaign.scheduled_at).toLocaleString() : "Not scheduled"}</div></td>
            <td style={{ padding: 10 }}>{campaign.status}</td><td style={{ padding: 10 }}>{group.length}</td>
            <td style={{ padding: 10 }}>{sent}</td><td style={{ padding: 10 }}>{failed}</td>
            <td style={{ padding: 10 }}>{opened}</td><td style={{ padding: 10 }}>{rate(opened, sent)}</td>
            <td style={{ padding: 10 }}>{clicked}</td><td style={{ padding: 10 }}>{rate(clicked, sent)}</td>
            <td style={{ padding: 10 }}>{reported}</td><td style={{ padding: 10 }}>{rate(reported, sent)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>}

    <section style={{ marginTop: 28, padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
      <h3 style={{ marginTop: 0 }}>How to interpret these signals</h3>
      <p>Open counts are approximate: image blocking, mail privacy proxies and security scanners can suppress or trigger tracking pixels. Do not treat an open as proof that a person read a message.</p>
      <p>A click is a learning opportunity, not a verdict about an employee. The self-report count records an optional response on the teachable-moment page after a simulation link is clicked; it is not a real mailbox report and does not notify IT. Use aggregate patterns to improve training and clarify the organisation's normal reporting route.</p>
      <p style={{ color: "#666", fontSize: 13, marginBottom: 0 }}>Small audiences can produce volatile percentages. Review counts alongside rates, and use the results for coaching rather than punitive decisions.</p>
    </section>
  </main>;
}

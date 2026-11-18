"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/client";

type Org = { id: string; name: string; aup_accepted_at: string | null };
type Group = { id: string; name: string };
type Template = { id: string; name: string; subject: string; body_html: string; difficulty: number; red_flags: string[] };
type Domain = { id: string; domain: string; verified_at: string | null };
type Target = { id: string; email: string; full_name: string | null };

function renderPreview(template: Template, target: Target | null) {
  const firstName = target?.full_name?.trim().split(/\s+/)[0] || "there";
  const trackingUrl = "https://simulation.example/track/preview";
  return {
    subject: template.subject.replaceAll("{{first_name}}", firstName),
    body: template.body_html
      .replaceAll("{{first_name}}", firstName)
      .replaceAll("{{tracking_url}}", trackingUrl),
  };
}

export default function CampaignsPage() {
  const supabase = createClient();
  const [org, setOrg] = useState<Org | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [domainId, setDomainId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from("org_members")
        .select("org_id,organizations(id,name,aup_accepted_at)")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      if (!membership) return;
      const o = (membership as any).organizations as Org;
      setOrg(o);

      const [{ data: g }, { data: t }, { data: d }, { data: people }] = await Promise.all([
        supabase.from("groups").select("id,name").eq("org_id", o.id).order("name"),
        supabase.from("templates").select("id,name,subject,body_html,difficulty,red_flags").is("org_id", null).order("name"),
        supabase.from("domains").select("id,domain,verified_at").eq("org_id", o.id).order("domain"),
        supabase.from("targets").select("id,email,full_name").eq("org_id", o.id).order("email")
      ]);
      setGroups(g || []);
      setTemplates(t || []);
      setDomains(d || []);
      setTargets(people || []);
    }
    load();
  }, []);

  const selectedTemplate = templates.find(t => t.id === templateId) || null;
  const selectedGroup = groups.find(g => g.id === groupId) || null;
  const selectedDomain = domains.find(d => d.id === domainId) || null;

  const [groupTargets, setGroupTargets] = useState<Target[]>([]);
  useEffect(() => {
    async function loadGroup() {
      if (!groupId) { setGroupTargets([]); return; }
      const { data } = await supabase
        .from("group_targets")
        .select("target_id")
        .eq("group_id", groupId);
      const ids = new Set((data || []).map((x: any) => x.target_id));
      setGroupTargets(targets.filter(t => ids.has(t.id)));
    }
    loadGroup();
  }, [groupId, targets]);

  const previewTarget = groupTargets[0] || null;
  const preview = useMemo(
    () => selectedTemplate && renderPreview(selectedTemplate, previewTarget),
    [selectedTemplate, previewTarget]
  );

  async function save(statusValue: "draft" | "scheduled") {
    if (!org || !selectedGroup || !selectedTemplate || !selectedDomain || !name.trim()) {
      setStatus("Complete the campaign name, group, template and sending domain first.");
      return;
    }
    if (statusValue === "scheduled" && !scheduledAt) {
      setStatus("Choose a future date and time before scheduling.");
      return;
    }
    if (statusValue === "scheduled" && !selectedDomain.verified_at) {
      setStatus("The sending domain must be verified before scheduling.");
      return;
    }
    if (statusValue === "scheduled" && !org.aup_accepted_at) {
      setStatus("Accept the acceptable-use terms before scheduling.");
      return;
    }
    if (!groupTargets.length) {
      setStatus("The selected group has no people yet.");
      return;
    }

    setBusy(true); setStatus("");
    const { data: { user } } = await supabase.auth.getUser();
    const payload = {
      org_id: org.id,
      name: name.trim(),
      template_id: selectedTemplate.id,
      domain_id: selectedDomain.id,
      group_id: selectedGroup.id,
      status: statusValue,
      scheduled_at: statusValue === "scheduled" ? new Date(scheduledAt).toISOString() : null,
      created_by: user?.id || null
    };
    const { error } = await supabase.from("campaigns").insert(payload);
    setBusy(false);
    if (error) { setStatus(error.message); return; }
    setCreated(true);
    setStatus(statusValue === "scheduled" ? "Campaign scheduled safely. No learner message is sent by this page." : "Draft saved.");
  }

  return (
    <main style={{ maxWidth: 1200, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Campaign Builder</h1>
      <p>Select a group, choose a fictional awareness scenario, schedule it, and inspect the learner-facing message before any sending workflow runs.</p>

      {status && <p role="status" style={{ padding: 12, border: "1px solid #ddd" }}>{status}</p>}

      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <h2>1. Campaign setup</h2>
          <label>Campaign name<br />
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Q4 phishing awareness" maxLength={200} style={{ width: "100%" }} />
          </label>

          <p><label>Group<br />
            <select value={groupId} onChange={e => setGroupId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select a group</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label></p>

          <p><label>Scenario<br />
            <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select a fictional scenario</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name} · difficulty {t.difficulty}/5</option>)}
            </select>
          </label></p>

          <p><label>Verified sending domain<br />
            <select value={domainId} onChange={e => setDomainId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Select a domain</option>
              {domains.map(d => <option key={d.id} value={d.id}>{d.domain}{d.verified_at ? " ✓ verified" : " · verification required"}</option>)}
            </select>
          </label></p>

          <p><label>Schedule (local browser time)<br />
            <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} style={{ width: "100%" }} />
          </label></p>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button disabled={busy} onClick={() => save("draft")}>Save draft</button>
            <button disabled={busy || !scheduledAt} onClick={() => save("scheduled")}>Schedule campaign</button>
          </div>

          {selectedGroup && <p style={{ marginTop: 16 }}><strong>Audience:</strong> {selectedGroup.name} · {groupTargets.length} learner(s)</p>}
          {created && <p><strong>Safety gate:</strong> this builder creates campaign metadata only. The separate server-side sending workflow must enforce the verified-domain, AUP and rate-limit checks.</p>}
        </div>

        <div>
          <h2>2. Learner preview</h2>
          {!preview ? <p>Choose a scenario to see the learner-facing message.</p> : (
            <article style={{ border: "1px solid #bbb", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ padding: 14, borderBottom: "1px solid #ddd" }}>
                <div style={{ fontSize: 12, color: "#666" }}>LEARNER PREVIEW</div>
                <strong>To: {previewTarget?.email || "selected group member"}</strong>
                <div><strong>Subject:</strong> {preview.subject}</div>
              </div>
              <div style={{ padding: 18 }} dangerouslySetInnerHTML={{ __html: preview.body }} />
            </article>
          )}
          {previewTarget && <p style={{ fontSize: 13, color: "#666" }}>Preview personalised for <strong>{previewTarget.full_name || previewTarget.email}</strong>. Each learner receives their own personalised copy. The preview link is a non-sending placeholder; real tracking links are generated server-side when the approved sending workflow runs.</p>}
          {selectedTemplate && <section style={{ marginTop: 20 }}><h3>Teaching signals</h3><ul>{selectedTemplate.red_flags.map(flag => <li key={flag}>{flag}</li>)}</ul></section>}
        </div>
      </section>
    </main>
  );
}

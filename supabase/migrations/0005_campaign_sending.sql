-- Campaign launch, sending queue, event tracking and stats.
--
-- Trust model:
--   * Admins (authenticated) can only call launch_campaign(); it is SECURITY DEFINER because recipients
--     are not client-writable, so it checks the caller's role itself.
--   * Everything else (claim/mark/record/start_due) is service_role only and is called from edge functions.

-- ---------- columns ----------
alter table campaigns
  add column sender_name  text not null default 'Notifications' check (length(sender_name) between 1 and 100),
  add column sender_local text not null default 'notifications' check (sender_local ~ '^[a-z0-9._-]{1,64}$');

alter table campaign_recipients
  add column claimed_at timestamptz,          -- lease: a claim older than the lease can be retried
  add column failure_reason text;
create index on campaign_recipients (campaign_id, status);

alter table training_modules add column slug text;
create unique index training_modules_builtin_slug on training_modules (slug) where org_id is null;
update training_modules set slug = 'spotting-phishing'
 where org_id is null and title = 'Spotting a phishing email';

-- ---------- launch (admin) ----------
create or replace function launch_campaign(
  p_campaign uuid, p_group_ids uuid[], p_scheduled_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c campaigns%rowtype;
  v_count int;
  v_future boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into c from campaigns where id = p_campaign for update;
  -- Same message for "missing" and "not yours" so ids cannot be probed.
  if not found or not is_org_member(c.org_id, array['owner','admin']::org_role[]) then
    raise exception 'campaign not found';
  end if;
  if c.status <> 'draft' then
    raise exception 'campaign is not a draft';
  end if;
  if p_group_ids is null or cardinality(p_group_ids) = 0 then
    raise exception 'choose at least one group';
  end if;
  if exists (
    select 1 from unnest(p_group_ids) g
    where not exists (select 1 from groups where id = g and org_id = c.org_id)
  ) then
    raise exception 'group not found in this organization';
  end if;

  -- Only people on a verified domain of this org are ever eligible.
  insert into campaign_recipients (campaign_id, org_id, target_id)
  select c.id, c.org_id, t.id
  from targets t
  where t.org_id = c.org_id
    and exists (select 1 from group_targets gt
                where gt.target_id = t.id and gt.group_id = any (p_group_ids))
    and exists (select 1 from domains d
                where d.org_id = c.org_id and d.domain = split_part(t.email, '@', 2)
                  and d.verified_at is not null)
  on conflict (campaign_id, target_id) do nothing;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'no eligible recipients in the selected groups';
  end if;
  if v_count > 5000 then
    raise exception 'too many recipients (max 5000 per campaign)';
  end if;

  v_future := p_scheduled_at is not null and p_scheduled_at > now();
  -- The guard_campaign trigger re-checks verified domain and accepted terms on this update.
  update campaigns
     set status = case when v_future then 'scheduled'::campaign_status else 'sending'::campaign_status end,
         scheduled_at = coalesce(p_scheduled_at, now())
   where id = c.id;

  insert into audit_log (org_id, actor, action, detail)
  values (c.org_id, auth.uid(), 'campaign.launched',
          jsonb_build_object('campaign_id', c.id, 'recipients', v_count, 'scheduled', v_future));

  return jsonb_build_object('recipients', v_count, 'status', case when v_future then 'scheduled' else 'sending' end);
end;
$$;
revoke all on function launch_campaign(uuid, uuid[], timestamptz) from public, anon;
grant execute on function launch_campaign(uuid, uuid[], timestamptz) to authenticated;

-- ---------- sending queue (service role) ----------
create or replace function start_due_campaigns()
returns setof uuid
language sql set search_path = public
as $$
  update campaigns set status = 'sending'
   where status = 'scheduled' and scheduled_at <= now()
  returning id;
$$;

-- Claims up to p_limit pending recipients with a lease, so two workers never take the same row.
create or replace function claim_recipients(
  p_campaign uuid, p_limit int default 25, p_lease interval default '10 minutes'
) returns table (
  recipient_id uuid, tracking_token text, email text, full_name text,
  subject text, body_html text, domain text, sender_name text, sender_local text,
  campaign_id uuid, org_id uuid
)
language sql set search_path = public
as $$
  with picked as (
    select r.id
    from campaign_recipients r
    join campaigns c on c.id = r.campaign_id
    join domains d   on d.id = c.domain_id
    where r.campaign_id = p_campaign
      and c.status = 'sending'
      and d.verified_at is not null
      and r.status = 'pending'
      and (r.claimed_at is null or r.claimed_at < now() - p_lease)
    order by r.id
    limit least(greatest(p_limit, 1), 100)
    for update of r skip locked
  ), upd as (
    update campaign_recipients r set claimed_at = now()
    from picked where r.id = picked.id
    returning r.*
  )
  select upd.id, upd.tracking_token, t.email, t.full_name,
         tpl.subject, tpl.body_html, d.domain, c.sender_name, c.sender_local, c.id, c.org_id
  from upd
  join targets t    on t.id = upd.target_id
  join campaigns c  on c.id = upd.campaign_id
  join templates tpl on tpl.id = c.template_id
  join domains d    on d.id = c.domain_id;
$$;

create or replace function complete_campaign_if_done(p_campaign uuid)
returns void
language sql set search_path = public
as $$
  update campaigns set status = 'completed'
   where id = p_campaign and status = 'sending'
     and not exists (select 1 from campaign_recipients where campaign_id = p_campaign and status = 'pending');
$$;

-- "delivered" means the email provider accepted the message.
create or replace function mark_recipient_sent(p_recipient uuid)
returns void
language plpgsql set search_path = public
as $$
declare r campaign_recipients%rowtype;
begin
  update campaign_recipients set status = 'sent', sent_at = now()
   where id = p_recipient and status = 'pending'
  returning * into r;
  if found then
    insert into campaign_events (recipient_id, org_id, type) values (r.id, r.org_id, 'delivered');
    perform complete_campaign_if_done(r.campaign_id);
  end if;
end;
$$;

create or replace function mark_recipient_failed(p_recipient uuid, p_reason text)
returns void
language plpgsql set search_path = public
as $$
declare r campaign_recipients%rowtype;
begin
  update campaign_recipients set status = 'failed', failure_reason = left(p_reason, 500)
   where id = p_recipient and status = 'pending'
  returning * into r;
  if found then
    perform complete_campaign_if_done(r.campaign_id);
  end if;
end;
$$;

-- ---------- tracking (service role) ----------
-- Returns null for unknown tokens (no oracle). 'delivered' is server-side only.
-- Clicks within 5 seconds of sending are ignored: mail security scanners pre-fetch links.
create or replace function record_event(p_token text, p_type event_type, p_user_agent text default null)
returns jsonb
language plpgsql set search_path = public
as $$
declare
  r campaign_recipients%rowtype;
  v_flags text[];
  v_name text;
begin
  if p_type not in ('opened', 'clicked', 'submitted', 'reported') then
    raise exception 'invalid event type';
  end if;

  select * into r from campaign_recipients where tracking_token = p_token and status = 'sent';
  if not found then
    return null;
  end if;

  select tpl.red_flags, tpl.name into v_flags, v_name
  from campaigns c join templates tpl on tpl.id = c.template_id
  where c.id = r.campaign_id;

  if p_type in ('clicked', 'submitted') and r.sent_at > now() - interval '5 seconds' then
    return jsonb_build_object('recorded', false, 'template_name', v_name, 'red_flags', to_jsonb(v_flags));
  end if;

  insert into campaign_events (recipient_id, org_id, type, user_agent)
  values (r.id, r.org_id, p_type, left(p_user_agent, 300));

  if p_type in ('clicked', 'submitted') then
    insert into training_assignments (org_id, target_id, module_id)
    select r.org_id, r.target_id, m.id
    from training_modules m where m.org_id is null and m.slug = 'spotting-phishing'
    on conflict (target_id, module_id) do nothing;
  end if;

  return jsonb_build_object('recorded', true, 'event', p_type, 'template_name', v_name, 'red_flags', to_jsonb(v_flags));
end;
$$;

-- Edge functions use the service role; nobody else may call these.
revoke all on function start_due_campaigns()                          from public, anon, authenticated;
revoke all on function claim_recipients(uuid, int, interval)          from public, anon, authenticated;
revoke all on function complete_campaign_if_done(uuid)                from public, anon, authenticated;
revoke all on function mark_recipient_sent(uuid)                      from public, anon, authenticated;
revoke all on function mark_recipient_failed(uuid, text)              from public, anon, authenticated;
revoke all on function record_event(text, event_type, text)           from public, anon, authenticated;
grant execute on function start_due_campaigns()                       to service_role;
grant execute on function claim_recipients(uuid, int, interval)       to service_role;
grant execute on function complete_campaign_if_done(uuid)             to service_role;
grant execute on function mark_recipient_sent(uuid)                   to service_role;
grant execute on function mark_recipient_failed(uuid, text)           to service_role;
grant execute on function record_event(text, event_type, text)        to service_role;

-- ---------- stats (RLS applies to the caller) ----------
create or replace view campaign_stats with (security_invoker = true) as
select
  c.id as campaign_id, c.org_id, c.name, c.status,
  count(r.id) filter (where r.status = 'sent')    as delivered,
  count(r.id) filter (where r.status = 'failed')  as failed,
  count(r.id) filter (where r.status = 'pending') as pending,
  count(r.id) filter (where exists (select 1 from campaign_events e where e.recipient_id = r.id and e.type = 'clicked'))  as clicked,
  count(r.id) filter (where exists (select 1 from campaign_events e where e.recipient_id = r.id and e.type = 'reported')) as reported,
  round(100.0 * count(r.id) filter (where exists (select 1 from campaign_events e where e.recipient_id = r.id and e.type = 'clicked'))
        / nullif(count(r.id) filter (where r.status = 'sent'), 0), 1)  as click_rate_pct,
  round(100.0 * count(r.id) filter (where exists (select 1 from campaign_events e where e.recipient_id = r.id and e.type = 'reported'))
        / nullif(count(r.id) filter (where r.status = 'sent'), 0), 1)  as report_rate_pct
from campaigns c
left join campaign_recipients r on r.campaign_id = c.id
group by c.id;

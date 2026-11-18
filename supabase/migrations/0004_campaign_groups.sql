-- Campaign audience selection for the safe campaign builder.
-- A campaign targets one existing organisation group; recipients are materialised by the
-- server-side sender so clients cannot forge recipient outcomes.

alter table campaigns
  add column if not exists group_id uuid references groups(id);

create index if not exists campaigns_group_idx on campaigns(group_id);

create or replace function guard_campaign()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  d domains%rowtype;
  t_org uuid;
  g_org uuid;
begin
  select * into d from domains where id = new.domain_id;
  if not found or d.org_id <> new.org_id then
    raise exception 'domain does not belong to this organization';
  end if;

  if new.group_id is null then
    raise exception 'campaign must have a target group';
  end if;

  select org_id into g_org from groups where id = new.group_id;
  if not found or g_org <> new.org_id then
    raise exception 'group does not belong to this organization';
  end if;

  select org_id into t_org from templates where id = new.template_id;
  if not found then
    raise exception 'template not found or not accessible to this organization';
  end if;
  if t_org is not null and t_org <> new.org_id then
    raise exception 'template does not belong to this organization';
  end if;

  if new.status <> 'draft' then
    if d.verified_at is null then
      raise exception 'domain must be verified before a campaign can be scheduled or sent';
    end if;
    if not exists (
      select 1 from organizations o
      where o.id = new.org_id and o.aup_accepted_at is not null
    ) then
      raise exception 'acceptable-use terms must be accepted before launching a campaign';
    end if;
    if new.scheduled_at is null then
      raise exception 'scheduled_at is required for a scheduled campaign';
    end if;
  end if;
  return new;
end;
$$;

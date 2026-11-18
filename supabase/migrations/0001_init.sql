-- Security awareness & phishing simulation platform: initial schema
-- Multi-tenant: every tenant table carries org_id and is protected by RLS.

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type org_role as enum ('owner', 'admin', 'analyst');
create type campaign_status as enum ('draft', 'scheduled', 'sending', 'completed', 'cancelled');
create type recipient_status as enum ('pending', 'sent', 'failed');
create type event_type as enum ('delivered', 'opened', 'clicked', 'submitted', 'reported');
create type assignment_status as enum ('assigned', 'in_progress', 'completed');

-- ---------- tenancy ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  aup_accepted_at timestamptz,          -- acceptable-use terms accepted
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role org_role not null default 'analyst',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on org_members (user_id);

-- Helper used by all policies. SECURITY DEFINER avoids recursive RLS on org_members.
create or replace function is_org_member(p_org uuid, p_roles org_role[] default null)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and (p_roles is null or m.role = any (p_roles))
  );
$$;

create table domains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  domain text not null check (domain = lower(domain)),
  verification_token text not null default encode(gen_random_bytes(16), 'hex'),
  verified_at timestamptz,
  unique (org_id, domain)
);

-- ---------- people being trained ----------
create table groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  unique (org_id, name)
);

create table targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null check (email = lower(email)),
  full_name text,
  department text,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create table group_targets (
  group_id uuid not null references groups(id) on delete cascade,
  target_id uuid not null references targets(id) on delete cascade,
  primary key (group_id, target_id)
);
create index on group_targets (target_id);

-- ---------- templates ----------
create table templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade, -- null = built-in library
  name text not null,
  subject text not null,
  body_html text not null,
  difficulty smallint not null default 1 check (difficulty between 1 and 5),
  red_flags text[] not null default '{}',   -- indicators shown on the teachable-moment page
  created_at timestamptz not null default now()
);
create index on templates (org_id);

-- ---------- campaigns ----------
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  template_id uuid not null references templates(id),
  domain_id uuid not null references domains(id),
  status campaign_status not null default 'draft',
  scheduled_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index on campaigns (org_id, status);

create table campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  target_id uuid not null references targets(id) on delete cascade,
  tracking_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  status recipient_status not null default 'pending',
  sent_at timestamptz,
  unique (campaign_id, target_id)          -- idempotent sending
);
create index on campaign_recipients (org_id);
create index on campaign_recipients (target_id);

-- Append-only. Deliberately no column for submitted form values.
create table campaign_events (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references campaign_recipients(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  type event_type not null,
  occurred_at timestamptz not null default now(),
  user_agent text
);
create index on campaign_events (recipient_id, type);
create index on campaign_events (org_id, occurred_at);

-- ---------- training ----------
create table training_modules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade, -- null = built-in
  title text not null,
  content_md text not null,
  est_minutes smallint check (est_minutes > 0)
);

create table training_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  target_id uuid not null references targets(id) on delete cascade,
  module_id uuid not null references training_modules(id),
  status assignment_status not null default 'assigned',
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (target_id, module_id)
);
create index on training_assignments (org_id, status);

-- ---------- audit ----------
create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id) on delete cascade,
  actor uuid references auth.users(id),
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on audit_log (org_id, created_at desc);

-- ---------- row level security ----------
alter table organizations        enable row level security;
alter table org_members          enable row level security;
alter table domains              enable row level security;
alter table groups               enable row level security;
alter table targets              enable row level security;
alter table group_targets        enable row level security;
alter table templates            enable row level security;
alter table campaigns            enable row level security;
alter table campaign_recipients  enable row level security;
alter table campaign_events      enable row level security;
alter table training_modules     enable row level security;
alter table training_assignments enable row level security;
alter table audit_log            enable row level security;

-- Read: any member. Write: owner/admin.
create policy org_read   on organizations for select using (is_org_member(id));
create policy org_update on organizations for update
  using (is_org_member(id, array['owner','admin']::org_role[]));

create policy members_read  on org_members for select using (is_org_member(org_id));
create policy members_write on org_members for all
  using (is_org_member(org_id, array['owner']::org_role[]))
  with check (is_org_member(org_id, array['owner']::org_role[]));

create policy domains_read  on domains for select using (is_org_member(org_id));
create policy domains_write on domains for all
  using (is_org_member(org_id, array['owner','admin']::org_role[]))
  with check (is_org_member(org_id, array['owner','admin']::org_role[]));

create policy groups_read  on groups for select using (is_org_member(org_id));
create policy groups_write on groups for all
  using (is_org_member(org_id, array['owner','admin']::org_role[]))
  with check (is_org_member(org_id, array['owner','admin']::org_role[]));

create policy targets_read  on targets for select using (is_org_member(org_id));
create policy targets_write on targets for all
  using (is_org_member(org_id, array['owner','admin']::org_role[]))
  with check (is_org_member(org_id, array['owner','admin']::org_role[]));

create policy group_targets_read on group_targets for select
  using (exists (select 1 from groups g where g.id = group_id and is_org_member(g.org_id)));
create policy group_targets_write on group_targets for all
  using (exists (select 1 from groups g where g.id = group_id
                 and is_org_member(g.org_id, array['owner','admin']::org_role[])))
  with check (exists (select 1 from groups g where g.id = group_id
                      and is_org_member(g.org_id, array['owner','admin']::org_role[])));

-- Built-in templates/modules (org_id null) are readable by any signed-in user.
create policy templates_read on templates for select
  using (org_id is null and auth.uid() is not null or is_org_member(org_id));
create policy templates_write on templates for all
  using (org_id is not null and is_org_member(org_id, array['owner','admin']::org_role[]))
  with check (org_id is not null and is_org_member(org_id, array['owner','admin']::org_role[]));

create policy modules_read on training_modules for select
  using (org_id is null and auth.uid() is not null or is_org_member(org_id));
create policy modules_write on training_modules for all
  using (org_id is not null and is_org_member(org_id, array['owner','admin']::org_role[]))
  with check (org_id is not null and is_org_member(org_id, array['owner','admin']::org_role[]));

create policy campaigns_read  on campaigns for select using (is_org_member(org_id));
create policy campaigns_write on campaigns for all
  using (is_org_member(org_id, array['owner','admin']::org_role[]))
  with check (is_org_member(org_id, array['owner','admin']::org_role[]));

create policy recipients_read on campaign_recipients for select using (is_org_member(org_id));
create policy events_read     on campaign_events     for select using (is_org_member(org_id));
create policy assignments_read on training_assignments for select using (is_org_member(org_id));
create policy audit_read on audit_log for select
  using (is_org_member(org_id, array['owner','admin']::org_role[]));

-- Org creation goes through this function so the creator becomes owner atomically
-- (there is deliberately no client INSERT policy on organizations/org_members).
create or replace function create_organization(p_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  insert into organizations (name) values (p_name) returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  return v_org;
end;
$$;
revoke all on function create_organization(text) from public, anon;
grant execute on function create_organization(text) to authenticated;

-- Recipients, events, assignments and audit rows are written only by edge functions
-- using the service role (which bypasses RLS). No client write policies are defined,
-- so authenticated users cannot forge outcomes.

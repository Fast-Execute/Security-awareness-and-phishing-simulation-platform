-- Domain verification guards.
-- Without these, the "domains_write" RLS policy would let any org admin set verified_at
-- themselves and skip DNS verification entirely.

-- 1. verified_at / verification_token / domain / org_id can only be set by the server.
--    Client roles (authenticated, anon) get their attempted changes silently reset.
create or replace function guard_domain_verification()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.verified_at := null;
      new.verification_token := encode(gen_random_bytes(16), 'hex');
    else
      new.verified_at := old.verified_at;
      new.verification_token := old.verification_token;
      new.domain := old.domain;
      new.org_id := old.org_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger domains_guard
before insert or update on domains
for each row execute function guard_domain_verification();

-- 2. A campaign may only leave 'draft' when:
--    - its domain belongs to the same org and is verified
--    - the org has accepted the acceptable-use terms
--    - its template is built-in or belongs to the same org
create or replace function guard_campaign()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  d domains%rowtype;
  t_org uuid;
begin
  select * into d from domains where id = new.domain_id;
  if not found or d.org_id <> new.org_id then
    raise exception 'domain does not belong to this organization';
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
  end if;
  return new;
end;
$$;

create trigger campaigns_guard
before insert or update on campaigns
for each row execute function guard_campaign();

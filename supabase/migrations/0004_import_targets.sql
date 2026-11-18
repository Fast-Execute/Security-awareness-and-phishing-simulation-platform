-- Bulk import of simulation targets (employees), optionally into a group.
-- SECURITY INVOKER (the default): RLS still applies, and we also check the caller's role explicitly.
--
-- Safety rule from docs/SAFETY.md: recipients must be the organisation's own staff, so an email is
-- only accepted if its domain is one the org has verified (exact match on the part after '@').
--
-- p_rows: [{"email": "...", "full_name": "...", "department": "...", "line": 2}, ...]
-- Returns: {"inserted": n, "updated": n, "skipped": n, "errors": [{"line": n, "email": "...", "reason": "..."}]}
-- Only the first 100 errors are listed; "skipped" is always the true total.

create or replace function import_targets(p_org uuid, p_rows jsonb, p_group uuid default null)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  c_max_rows constant int := 5000;
  c_max_errors constant int := 100;
  r record;
  v_email text;
  v_domain text;
  v_line text;
  v_target uuid;
  v_was_insert boolean;
  v_inserted int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_reason text;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if not is_org_member(p_org, array['owner','admin']::org_role[]) then
    raise exception 'forbidden';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > c_max_rows then
    raise exception 'too many rows (max % per import)', c_max_rows;
  end if;
  if p_group is not null
     and not exists (select 1 from groups where id = p_group and org_id = p_org) then
    raise exception 'group not found in this organization';
  end if;

  for r in select value as val, ordinality as n from jsonb_array_elements(p_rows) with ordinality loop
    v_email  := lower(btrim(coalesce(r.val->>'email', '')));
    v_line   := coalesce(r.val->>'line', r.n::text);
    v_reason := null;

    if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_reason := 'invalid email address';
    else
      v_domain := split_part(v_email, '@', 2);
      if not exists (
        select 1 from domains
        where org_id = p_org and domain = v_domain and verified_at is not null
      ) then
        v_reason := 'domain is not a verified domain of this organization';
      elsif v_email = any (v_seen) then
        v_reason := 'duplicate address in this file';
      end if;
    end if;

    if v_reason is not null then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_errors) < c_max_errors then
        v_errors := v_errors || jsonb_build_object('line', v_line, 'email', left(v_email, 254), 'reason', v_reason);
      end if;
      continue;
    end if;

    v_seen := v_seen || v_email;

    insert into targets (org_id, email, full_name, department)
    values (
      p_org, v_email,
      left(nullif(btrim(r.val->>'full_name'), ''), 200),
      left(nullif(btrim(r.val->>'department'), ''), 200)
    )
    on conflict (org_id, email) do update
      set full_name  = coalesce(excluded.full_name,  targets.full_name),
          department = coalesce(excluded.department, targets.department)
    returning id, (xmax = 0) into v_target, v_was_insert;

    if v_was_insert then v_inserted := v_inserted + 1; else v_updated := v_updated + 1; end if;

    if p_group is not null then
      insert into group_targets (group_id, target_id) values (p_group, v_target)
      on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped, 'errors', v_errors
  );
end;
$$;

revoke all on function import_targets(uuid, jsonb, uuid) from public, anon;
grant execute on function import_targets(uuid, jsonb, uuid) to authenticated;

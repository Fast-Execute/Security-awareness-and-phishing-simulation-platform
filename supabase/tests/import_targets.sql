-- Checks for import_targets(). Lines marked "expect" state the correct outcome.
\set ON_ERROR_STOP off
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1'),   -- admin of org A
 ('00000000-0000-0000-0000-0000000000a2'),   -- analyst of org A
 ('00000000-0000-0000-0000-0000000000b2');   -- admin of org B

set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset
select create_organization('Acme') as orga \gset
insert into domains(org_id,domain) values (:'orga','acme.co.za'), (:'orga','pending.com');
insert into groups(org_id,name) values (:'orga','Finance') returning id as grp \gset
reset role;
insert into org_members values (:'orga','00000000-0000-0000-0000-0000000000a2','analyst');
-- Verification is a server-side action (edge function, service role); the guard trigger undoes it for clients.
select set_config('request.jwt.claim.role','service_role',false) \gset
update domains set verified_at = now() where domain = 'acme.co.za';   -- pending.com stays unverified
select set_config('request.jwt.claim.role','authenticated',false) \gset
set role authenticated;

\echo '--- T1 mixed file (expect inserted 2, skipped 5; reasons: invalid, unverified x2, duplicate, subdomain)'
select jsonb_pretty(import_targets(:'orga', '[
  {"email":"ann@acme.co.za","full_name":"Ann Smith","department":"Finance","line":2},
  {"email":"  BOB@ACME.CO.ZA ","full_name":"Bob","line":3},
  {"email":"not-an-email","line":4},
  {"email":"x@pending.com","line":5},
  {"email":"ann@acme.co.za","line":6},
  {"email":"eve@evil.com","line":7},
  {"email":"sub@mail.acme.co.za","line":8}
]'::jsonb, :'grp')) as result;

\echo '--- T2 stored emails are lowercased/trimmed and both are in the group (expect 2 targets, 2 group members)'
select (select count(*) from targets where email in ('ann@acme.co.za','bob@acme.co.za')) as targets,
       (select count(*) from group_targets where group_id = :'grp') as in_group;

\echo '--- T3 re-import updates, keeps existing name when blank (expect updated 1; name stays Ann Smith, dept Legal)'
select import_targets(:'orga', '[{"email":"ann@acme.co.za","department":"Legal"}]'::jsonb) ->> 'updated' as updated;
select full_name, department from targets where email = 'ann@acme.co.za';

\echo '--- T4 re-import into the group does not duplicate membership (expect still 2)'
select import_targets(:'orga', '[{"email":"bob@acme.co.za"}]'::jsonb, :'grp') -> 'inserted' as inserted;
select count(*) as in_group from group_targets where group_id = :'grp';

\echo '--- T5 missing line number falls back to row position (expect line "1")'
select import_targets(:'orga', '[{"email":"bad"}]'::jsonb) -> 'errors' -> 0 ->> 'line' as line;

\echo '--- T6 analyst cannot import (expect error: forbidden)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a2',false) \gset
select import_targets(:'orga', '[{"email":"zed@acme.co.za"}]'::jsonb);

\echo '--- T7 org B admin cannot import into org A (expect error: forbidden)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',false) \gset
select import_targets(:'orga', '[{"email":"zed@acme.co.za"}]'::jsonb);

\echo '--- T8 org B admin cannot use org A group id (expect error)'
select create_organization('Beta') as orgb \gset
select import_targets(:'orgb', '[]'::jsonb, :'grp');

\echo '--- T9 row cap (expect error: too many rows)'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset
select import_targets(:'orga', (select jsonb_agg(jsonb_build_object('email','u'||g||'@acme.co.za')) from generate_series(1,5001) g));

\echo '--- T10 non-array payload (expect error)'
select import_targets(:'orga', '{"email":"a@acme.co.za"}'::jsonb);

\echo '--- T11 anonymous caller cannot execute (expect permission error)'
reset role; set role anon;
select import_targets(:'orga', '[]'::jsonb);

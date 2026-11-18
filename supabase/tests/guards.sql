-- Guard and RLS checks for migrations 0001-0003. Run with psql against a scratch DB that has
-- the migrations applied and Supabase-style auth stubs (auth.users, auth.uid(), auth.role(), roles
-- anon/authenticated/service_role). Each test prints an expectation; errors are expected where noted.
\set ON_ERROR_STOP off
insert into auth.users values
 ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000b2'),('00000000-0000-0000-0000-0000000000c3');

-- u1 creates org A
set role authenticated; select set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset
\echo '--- T1 create org via function (expect uuid)'
select create_organization('Org A') as orgA \gset
select :'orga' is not null as ok;
\echo '--- T2 client tries direct org insert (expect permission/RLS error)'
insert into organizations(name) values ('sneaky');

\echo '--- T3 domain insert with forged verified_at + token (expect verified_at null, token not forged)'
insert into domains(org_id,domain,verified_at,verification_token) values (:'orga','a.example',now(),'forged') returning verified_at is null as verified_is_null, verification_token <> 'forged' as token_server_made;
\echo '--- T4 client updates verified_at (expect still null)'
update domains set verified_at = now() where domain='a.example';
select verified_at is null as still_unverified from domains where domain='a.example';

\echo '--- T5 draft campaign with built-in template (expect ok)'
insert into campaigns(org_id,name,template_id,domain_id)
 select :'orga','c1',(select id from templates limit 1),(select id from domains where domain='a.example') returning status;
\echo '--- T6 schedule with unverified domain (expect error: must be verified)'
update campaigns set status='scheduled' where name='c1';

-- server verifies the domain
reset role; select set_config('request.jwt.claim.role','service_role',false) \gset
update domains set verified_at = now() where domain='a.example';
set role authenticated; select set_config('request.jwt.claim.role','authenticated',false) \gset
\echo '--- T7 schedule before AUP accepted (expect error: acceptable-use)'
update campaigns set status='scheduled' where name='c1';
\echo '--- T8 accept AUP then schedule (expect ok)'
update organizations set aup_accepted_at = now() where id = :'orga';
update campaigns set status='scheduled' where name='c1' returning status;

-- u2 creates org B with its own template + domain
reset role; set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b2',false) \gset
select create_organization('Org B') as orgB \gset
insert into templates(org_id,name,subject,body_html) values (:'orgb','tB','s','b');
insert into domains(org_id,domain) values (:'orgb','b.example');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false) \gset
\echo '--- T9 org A campaign uses org B template (expect error)'
insert into campaigns(org_id,name,template_id,domain_id)
 select :'orga','x1',(select id from templates where name='tB'),(select id from domains where domain='a.example');
\echo '--- T10 org A campaign uses org B domain (expect error)'
insert into campaigns(org_id,name,template_id,domain_id)
 select :'orga','x2',(select id from templates where org_id is null limit 1),(select id from domains where domain='b.example');
\echo '--- T11 u1 sees only own org data (expect 1 org, 0 of B domains)'
select (select count(*) from organizations) as orgs_visible, (select count(*) from domains where domain='b.example') as b_domains_visible;

-- non-member
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false) \gset
\echo '--- T12 non-member sees nothing (expect 0,0,0) but still sees built-in templates (6)'
select (select count(*) from organizations) o, (select count(*) from campaigns) c, (select count(*) from domains) d, (select count(*) from templates) t;
\echo '--- T13 non-member tries to forge a campaign event (expect RLS error)'
insert into campaign_events(recipient_id,org_id,type) values (gen_random_uuid(), :'orga','clicked');
